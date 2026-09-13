const http = require('http');
const fs = require('fs');
const path = require('path');
const { createDb, validateAndStore } = require('./contact-core');
const cc = require('./content-core');
const sc = require('./site-core');
const root = __dirname;
const siteDb = sc.createDb(path.join(root, process.env.DATABASE_PATH || 'talora.db'));
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.ico':'image/x-icon'};

// ---- Database (SQLite, persisted on disk) ----
const db = createDb(path.join(root, process.env.DATABASE_PATH || 'talora.db'));

function handleContact(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
  req.on('end', async () => {
    const result = await validateAndStore(db, body);
    if (result.ok) {
      return sendJson(res, result.status, { success: true, message: 'Your message has been sent successfully.', id: result.id });
    }
    return sendJson(res, result.status, { success: false, message: result.message });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---- Content CMS API (admin-protected) ----
function readBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
  req.on('end', () => cb(body));
}

function requireAuth(req, res) {
  if (!cc.verifyAuth(req)) {
    sendJson(res, 401, { success: false, message: 'You are not authorized to perform this action.' });
    return false;
  }
  return true;
}

// Content id from /api/content/<id>
function contentIdFromPath(p) {
  const m = /^\/api\/content\/(.+)$/.exec(p);
  return m ? m[1] : null;
}

async function handleContent(req, res, p) {
  const id = contentIdFromPath(p);
  const method = req.method;
  const q = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));

  if (!id && method === 'GET') {
    if (!requireAuth(req, res)) return;
    try {
      const items = await cc.listContent(db, { category: q.category, status: q.status, search: q.search, section: q.section });
      return sendJson(res, 200, { success: true, items });
    } catch (err) {
      console.error('GET /api/content failed:', err.message);
      return sendJson(res, 500, { success: false, message: 'Failed to load content. Please try again.' });
    }
  }

  if (!id && method === 'POST') {
    if (!requireAuth(req, res)) return;
    return readBody(req, async (body) => {
      const v = cc.validateContent(body);
      if (!v.ok) return sendJson(res, v.status, { success: false, message: v.message });
      try {
        const item = await cc.createContent(db, v.fields);
        return sendJson(res, 201, { success: true, message: 'Content created successfully.', item });
      } catch (err) {
        console.error('POST /api/content failed:', err.message);
        return sendJson(res, 500, { success: false, message: 'Failed to create content. Please try again.' });
      }
    });
  }

  if (id && (method === 'GET' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    if (!requireAuth(req, res)) return;
    if (method === 'GET') {
      try {
        const item = await cc.getContent(db, id);
        if (!item) return sendJson(res, 404, { success: false, message: 'Content not found.' });
        return sendJson(res, 200, { success: true, item });
      } catch (err) {
        console.error('GET /api/content/:id failed:', err.message);
        return sendJson(res, 500, { success: false, message: 'Failed to load content. Please try again.' });
      }
    }
    if (method === 'PUT' || method === 'PATCH') {
      return readBody(req, async (body) => {
        const v = cc.validateContent(body);
        if (!v.ok) return sendJson(res, v.status, { success: false, message: v.message });
        try {
          const item = await cc.updateContent(db, id, v.fields);
          if (!item) return sendJson(res, 404, { success: false, message: 'Content not found.' });
          return sendJson(res, 200, { success: true, message: 'Content updated successfully.', item });
        } catch (err) {
          console.error('PUT /api/content/:id failed:', err.message);
          return sendJson(res, 500, { success: false, message: 'Failed to update content. Please try again.' });
        }
      });
    }
    try {
      const deleted = await cc.deleteContent(db, id);
      if (!deleted) return sendJson(res, 404, { success: false, message: 'Content not found.' });
      return sendJson(res, 200, { success: true, message: 'Content deleted successfully.' });
    } catch (err) {
      console.error('DELETE /api/content/:id failed:', err.message);
      return sendJson(res, 500, { success: false, message: 'Failed to delete content. Please try again.' });
    }
  }

  res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, POST, PUT, PATCH, DELETE' });
  return res.end(JSON.stringify({ success: false, message: 'Method not allowed.' }));
}

http.createServer((req, res) => { handleRequest(req, res); });

async function handleRequest(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
const q = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));
  if (p === '/api/contact') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
      return res.end(JSON.stringify({ success: false, message: 'Method not allowed.' }));
    }
    return handleContact(req, res);
  }
  if (p === '/api/auth/login') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
      return res.end(JSON.stringify({ success: false, message: 'Method not allowed.' }));
    }
    return readBody(req, (body) => {
      const result = cc.login(body);
      return sendJson(res, result.ok ? 200 : result.status,
        result.ok
          ? { success: true, message: 'Signed in successfully.', token: result.token, expiresAt: result.expiresAt }
          : { success: false, message: result.message });
    });
  }
  if (p === '/api/auth/me') {
    if (!cc.verifyAuth(req)) {
      return sendJson(res, 401, { success: false, message: 'You are not authorized to perform this action.' });
    }
    return sendJson(res, 200, { success: true, user: { username: cc.adminCredentials().username, role: 'admin' } });
  }
  // Public, unauthenticated endpoint: only PUBLISHED website content is exposed
  if (p === '/api/website-content') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
      return res.end(JSON.stringify({ success: false, message: 'Method not allowed.' }));
    }
    try {
      const values = await sc.getSettings(siteDb, { publicOnly: true });
      return sendJson(res, 200, { success: true, values });
    } catch (err) {
      console.error('GET /api/website-content failed:', err.message);
      return sendJson(res, 500, { success: false, message: 'Failed to load website content.' });
    }
  }

  // Admin-only website-content settings (full map incl. defaults + section metadata)
  if (p === '/api/website-settings') {
    if (!sc.verifyAdmin(req)) {
      return sendJson(res, 401, { success: false, message: 'You are not authorized to perform this action.' });
    }
    if (req.method === 'GET') {
      try {
        const values = await sc.getSettings(siteDb);
        return sendJson(res, 200, { success: true, sections: sc.SECTIONS, values, defaults: sc.DEFAULTS });
      } catch (err) {
        console.error('GET /api/website-settings failed:', err.message);
        return sendJson(res, 500, { success: false, message: 'Failed to load website settings.' });
      }
    }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      return readBody(req, async (body) => {
        try {
          const result = await sc.saveSettings(siteDb, body);
          if (!result.ok) return sendJson(res, result.status, { success: false, message: result.message });
          const values = await sc.getSettings(siteDb);
          return sendJson(res, 200, { success: true, message: 'Website content saved successfully.', values });
        } catch (err) {
          console.error('PUT /api/website-settings failed:', err.message);
          return sendJson(res, 500, { success: false, message: 'Failed to save website content.' });
        }
      });
    }
    res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, PUT, PATCH' });
    return res.end(JSON.stringify({ success: false, message: 'Method not allowed.' }));
  }

  if (p === '/api/content' || p.startsWith('/api/content/')) {
    return handleContent(req, res, p);
  }
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
}

http.createServer(handleRequest).listen(5501, () => console.log('Serving at http://localhost:5501 (contact API: POST /api/contact)'));
