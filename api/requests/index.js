const { createRequest, listRequests, getRequestById, updateRequestStatus, pgConnectionString, createDb } = require('../../requests-core');
const { verifyAuth } = require('../../content-core');

function getDb() {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return null;
  const path = require('path');
  return createDb(process.env.DATABASE_PATH || path.join('/tmp', 'talora.db'));
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname || '/');
  const method = (req.method || 'GET').toUpperCase();

  if (pathname === '/api/requests' && method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', async () => {
      const db = getDb();
      const result = await createRequest(db, body);
      if (!result.ok) return json(res, result.status || 500, { success: false, message: result.message || 'Unable to submit request.' });
      return json(res, 201, { success: true, message: 'Your request has been submitted successfully.', request: result });
    });
    return;
  }

  if (pathname === '/api/requests' && method === 'GET') {
    if (!verifyAuth(req)) return json(res, 401, { success: false, message: 'You are not authorized to access requests.' });
    const db = getDb();
    const data = await listRequests(db, { status: url.searchParams.get('status'), search: url.searchParams.get('search'), sort: url.searchParams.get('sort') || 'newest', limit: url.searchParams.get('limit') || 25 });
    return json(res, 200, { success: true, items: data.items, total: data.total });
  }

  return json(res, 404, { success: false, message: 'Not found.' });
};
