const contentCore = require('../content-core');
const requestsCore = require('../requests-core');
const servicesCore = require('../services-core');
const siteCore = require('../site-core');
const authUserApi = require('../auth-user-api');
const authUserCore = require('../auth-user-core');

const sqliteDbs = new Map();

function json(res, status, body) {
  if (typeof res.status === 'function') return res.status(status).json(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function statusJson(res, status, body) {
  return json(res, status, body);
}

function getDb(key, createDb, pgConnectionString) {
  if (pgConnectionString()) return null;
  if (!sqliteDbs.has(key)) {
    const path = require('path');
    sqliteDbs.set(key, createDb(process.env.DATABASE_PATH || path.join('/tmp', 'talora.db')));
  }
  return sqliteDbs.get(key);
}

async function readBody(req, limit = 200000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requestPath(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/api/[...path]') {
    return '/api/' + (url.searchParams.get('path') || '');
  }
  return decodeURIComponent(url.pathname || '/');
}

function method(req) {
  return (req.method || 'GET').toUpperCase();
}

function statusHelper(res) {
  return (code) => (typeof res.status === 'function' ? res.status(code) : (res.statusCode = code, res));
}

function jsonHelper(res) {
  return (body) => (typeof res.json === 'function' ? res.json(body) : res.end(JSON.stringify(body)));
}

async function handleContact(req, res) {
  const { createDb, validateAndStore } = require('../contact-core');
  res.setHeader('Cache-Control', 'no-store');
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  if (method(req) !== 'POST') {
    res.setHeader('Allow', 'POST');
    return status(405), respond({ success: false, message: 'Method not allowed.' });
  }
  try {
    const result = await validateAndStore(getDb('contact', createDb, () => Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL)), await readBody(req, 10000));
    status(result.status);
    return respond(result.ok
      ? { success: true, message: 'Your message has been sent successfully.', id: result.id }
      : { success: false, message: result.message });
  } catch (err) {
    return statusJson(res, err.status || 500, { success: false, message: err.status ? err.message : 'Unable to process your message.' });
  }
}

async function handleWebsiteContent(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  if (method(req) !== 'GET') {
    res.setHeader('Allow', 'GET');
    return status(405), respond({ success: false, message: 'Method not allowed.' });
  }
  try {
    const values = await siteCore.getSettings(getDb('site', siteCore.createDb, siteCore.pgConnectionString), { publicOnly: true });
    return status(200), respond({ success: true, values });
  } catch (err) {
    console.error('GET /api/website-content failed:', err.message);
    return status(500), respond({ success: false, message: 'Failed to load website content.' });
  }
}

async function handleWebsiteSettings(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  const unauthorized = () => { status(401); return respond({ success: false, message: 'You are not authorized to perform this action.' }); };
  if (!siteCore.verifyAdmin(req)) return unauthorized();
  if (method(req) === 'GET') {
    try {
      const values = await siteCore.getSettings(getDb('site', siteCore.createDb, siteCore.pgConnectionString));
      return status(200), respond({ success: true, sections: siteCore.SECTIONS, values, defaults: siteCore.DEFAULTS });
    } catch (err) {
      console.error('GET /api/website-settings failed:', err.message);
      return status(500), respond({ success: false, message: 'Failed to load website settings.' });
    }
  }
  if (method(req) === 'PUT' || method(req) === 'PATCH') {
    try {
      const result = await siteCore.saveSettings(getDb('site', siteCore.createDb, siteCore.pgConnectionString), await readBody(req));
      if (!result.ok) return status(result.status), respond({ success: false, message: result.message });
      const values = await siteCore.getSettings(getDb('site', siteCore.createDb, siteCore.pgConnectionString));
      return status(200), respond({ success: true, message: 'Website content saved successfully.', values });
    } catch (err) {
      console.error('PUT /api/website-settings failed:', err.message);
      return status(500), respond({ success: false, message: 'Failed to save website content.' });
    }
  }
  res.setHeader('Allow', 'GET, PUT, PATCH');
  return status(405), respond({ success: false, message: 'Method not allowed.' });
}

async function handleContent(req, res, parts) {
  res.setHeader('Cache-Control', 'no-store');
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  const unauthorized = () => { status(401); return respond({ success: false, message: 'You are not authorized to perform this action.' }); };
  if (!contentCore.verifyAuth(req)) return unauthorized();
  const db = getDb('content', contentCore.createDb, contentCore.pgConnectionString);
  if (parts.length === 1 && method(req) === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    try {
      const items = await contentCore.listContent(db, { category: q.get('category'), status: q.get('status'), search: q.get('search'), section: q.get('section') });
      return status(200), respond({ success: true, items });
    } catch (err) {
      console.error('GET /api/content failed:', err.message);
      return status(500), respond({ success: false, message: 'Failed to load content. Please try again.' });
    }
  }
  if (parts.length === 1 && method(req) === 'POST') {
    const validation = contentCore.validateContent(await readBody(req));
    if (!validation.ok) return status(validation.status), respond({ success: false, message: validation.message });
    try {
      const item = await contentCore.createContent(db, validation.fields);
      return status(201), respond({ success: true, message: 'Content created successfully.', item });
    } catch (err) {
      console.error('POST /api/content failed:', err.message);
      return status(500), respond({ success: false, message: 'Failed to create content. Please try again.' });
    }
  }
  if (parts.length === 2) {
    const id = parts[1];
    if (method(req) === 'GET') {
      const item = await contentCore.getContent(db, id);
      return item ? (status(200), respond({ success: true, item })) : (status(404), respond({ success: false, message: 'Content not found.' }));
    }
    if (method(req) === 'PUT' || method(req) === 'PATCH') {
      const validation = contentCore.validateContent(await readBody(req));
      if (!validation.ok) return status(validation.status), respond({ success: false, message: validation.message });
      const item = await contentCore.updateContent(db, id, validation.fields);
      return item ? (status(200), respond({ success: true, message: 'Content updated successfully.', item })) : (status(404), respond({ success: false, message: 'Content not found.' }));
    }
    if (method(req) === 'DELETE') {
      const deleted = await contentCore.deleteContent(db, id);
      return deleted ? (status(200), respond({ success: true, message: 'Content deleted successfully.' })) : (status(404), respond({ success: false, message: 'Content not found.' }));
    }
  }
  res.setHeader('Allow', parts.length === 1 ? 'GET, POST' : 'GET, PUT, PATCH, DELETE');
  return status(405), respond({ success: false, message: 'Method not allowed.' });
}

async function handleRequests(req, res, parts) {
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  const db = getDb('requests', requestsCore.createDb, requestsCore.pgConnectionString);
  if (parts.length === 1 && method(req) === 'POST') {
    const result = await requestsCore.createRequest(db, await readBody(req));
    return result.ok ? (status(201), respond({ success: true, message: 'Your request has been submitted successfully.', request: result })) : (status(result.status || 500), respond({ success: false, message: result.message || 'Unable to submit request.' }));
  }
  if (!contentCore.verifyAuth(req)) return status(401), respond({ success: false, message: 'You are not authorized to access requests.' });
  if (parts.length === 1 && method(req) === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const data = await requestsCore.listRequests(db, { status: q.get('status'), search: q.get('search'), sort: q.get('sort') || 'newest', limit: q.get('limit') || 25 });
    return status(200), respond({ success: true, items: data.items, total: data.total });
  }
  const id = parts[1];
  if (!id) return status(404), respond({ success: false, message: 'Request not found.' });
  if (parts.length === 3 && parts[2] === 'status') {
    if (method(req) !== 'PATCH') return status(405), respond({ success: false, message: 'Method not allowed.' });
    const result = await requestsCore.updateRequestStatus(db, id, JSON.parse(await readBody(req) || '{}').status);
    return result.ok ? (status(200), respond({ success: true, message: 'Request status updated.', request: result })) : (status(result.status || 400), respond({ success: false, message: result.message }));
  }
  if (parts.length === 2 && method(req) === 'GET') {
    const request = await requestsCore.getRequestById(db, id);
    return request ? (status(200), respond({ success: true, request })) : (status(404), respond({ success: false, message: 'Request not found.' }));
  }
  return status(405), respond({ success: false, message: 'Method not allowed.' });
}

async function handleServices(req, res, parts) {
  res.setHeader('Cache-Control', 'no-store');
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  const db = getDb('services', servicesCore.createDb, servicesCore.pgConnectionString);
  if (parts[0] === 'services') {
    if (parts.length !== 1 || method(req) !== 'GET') { res.setHeader('Allow', 'GET'); return status(405), respond({ success: false, message: 'Method not allowed.' }); }
    try { return status(200), respond({ success: true, items: await servicesCore.listServices(db, { status: 'active' }) }); }
    catch (err) { console.error('GET /api/services failed:', err.message); return status(500), respond({ success: false, message: 'Failed to load services.' }); }
  }
  const admin = parts[0] === 'admin' && parts[1] === 'services';
  if (!admin) return status(404), respond({ success: false, message: 'Not found.' });
  const unauthorized = () => { status(401); return respond({ success: false, message: 'You are not authorized to perform this action.' }); };
  if (!contentCore.verifyAuth(req)) return unauthorized();
  if (parts.length === 2 && method(req) === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    try { return status(200), respond({ success: true, items: await servicesCore.listServices(db, { status: q.get('status') || undefined }) }); }
    catch (err) { return status(500), respond({ success: false, message: 'Failed to load services. Please try again.' }); }
  }
  if (parts.length === 2 && method(req) === 'POST') {
    const validation = servicesCore.validateService(await readBody(req));
    if (!validation.ok) return status(validation.status), respond({ success: false, message: validation.message });
    try { return status(201), respond({ success: true, message: 'Service created successfully.', item: await servicesCore.createService(db, validation.fields) }); }
    catch (err) { return status(500), respond({ success: false, message: 'Failed to create service. Please try again.' }); }
  }
  const id = parts[2];
  if (!id) return status(405), respond({ success: false, message: 'Method not allowed.' });
  if (method(req) === 'GET') {
    const item = await servicesCore.getService(db, id);
    return item ? (status(200), respond({ success: true, item })) : (status(404), respond({ success: false, message: 'Service not found.' }));
  }
  if (method(req) === 'PUT' || method(req) === 'PATCH') {
    const validation = servicesCore.validateService(await readBody(req));
    if (!validation.ok) return status(validation.status), respond({ success: false, message: validation.message });
    const item = await servicesCore.updateService(db, id, validation.fields);
    return item ? (status(200), respond({ success: true, message: 'Service updated successfully.', item })) : (status(404), respond({ success: false, message: 'Service not found.' }));
  }
  if (method(req) === 'DELETE') {
    const deleted = await servicesCore.deleteService(db, id);
    return deleted ? (status(200), respond({ success: true, message: 'Service deleted successfully.' })) : (status(404), respond({ success: false, message: 'Service not found.' }));
  }
  return status(405), respond({ success: false, message: 'Method not allowed.' });
}

async function handleAdminLogin(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  if (method(req) !== 'POST') { res.setHeader('Allow', 'POST'); return status(405), respond({ success: false, message: 'Method not allowed.' }); }
  const result = contentCore.login(await readBody(req));
  return result.ok ? (status(200), respond({ success: true, message: 'Signed in successfully.', token: result.token, expiresAt: result.expiresAt })) : (status(result.status), respond({ success: false, message: result.message }));
}

async function handleMe(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const status = statusHelper(res);
  const respond = jsonHelper(res);
  if (method(req) !== 'GET') { res.setHeader('Allow', 'GET'); return status(405), respond({ success: false, message: 'Method not allowed.' }); }
  const user = await authUserCore.getUserFromRequest(req);
  if (user) return status(200), respond({ success: true, user: { id: user.id, fullName: user.full_name, email: user.email, role: 'user' } });
  if (!contentCore.verifyAuth(req)) return status(401), respond({ success: false, message: 'You are not authorized to perform this action.' });
  return status(200), respond({ success: true, user: { username: contentCore.adminCredentials().username, role: 'admin' } });
}

module.exports = async function handler(req, res) {
  const parts = requestPath(req).split('/').filter(Boolean).slice(1);
  try {
    if (parts[0] === 'contact') return handleContact(req, res);
    if (parts[0] === 'website-content') return handleWebsiteContent(req, res);
    if (parts[0] === 'website-settings') return handleWebsiteSettings(req, res);
    if (parts[0] === 'content') return handleContent(req, res, parts);
    if (parts[0] === 'requests') return handleRequests(req, res, parts);
    if (parts[0] === 'services' || (parts[0] === 'admin' && parts[1] === 'services')) return handleServices(req, res, parts);
    if (parts[0] === 'auth' && parts[1] === 'login') return authUserApi.login(req, res);
    if (parts[0] === 'auth' && parts[1] === 'logout') return authUserApi.logout(req, res);
    if (parts[0] === 'auth' && parts[1] === 'register') return authUserApi.register(req, res);
    if (parts[0] === 'auth' && parts[1] === 'user-login') return authUserApi.login(req, res);
    if (parts[0] === 'auth' && parts[1] === 'me') return handleMe(req, res);
    if (parts[0] === 'user' && parts[1] === 'profile') return authUserApi.profile(req, res);
    return statusJson(res, 404, { success: false, message: 'Not found.' });
  } catch (err) {
    console.error('API dispatcher error:', err);
    return statusJson(res, err.status || 500, { success: false, message: err.status ? err.message : 'Internal server error.' });
  }
};