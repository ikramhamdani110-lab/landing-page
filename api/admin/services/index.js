// Vercel serverless: /api/admin/services (admin token required)
//   GET  /api/admin/services — list ALL services (active + inactive, for the CMS)
//   POST /api/admin/services — create a service
const { pgConnectionString, verifyAuth, listServices, createService, validateService } = require('../../../services-core');

let sqliteDb = null;
function getDb() {
  if (!sqliteDb && !pgConnectionString()) {
    const path = require('path');
    sqliteDb = require('../../../services-core').createDb(process.env.DATABASE_PATH || path.join('/tmp', 'talora.db'));
  }
  return sqliteDb;
}

const unauthorized = (status, json) => { status(401); json({ success: false, message: 'You are not authorized to perform this action.' }); };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const status = (c) => (typeof res.status === 'function' ? res.status(c) : (res.statusCode = c, res));
  const json = (o) => (typeof res.json === 'function' ? res.json(o) : res.end(JSON.stringify(o)));

  if (req.method === 'GET') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    try {
      const items = await listServices(getDb(), { status: q.get('status') || undefined });
      return status(200), json({ success: true, items });
    } catch (err) {
      console.error('GET /api/admin/services failed:', err.message);
      return status(500), json({ success: false, message: 'Failed to load services. Please try again.' });
    }
  }

  if (req.method === 'POST') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', async () => {
      const v = validateService(body);
      if (!v.ok) { status(v.status); return json({ success: false, message: v.message }); }
      try {
        const item = await createService(getDb(), v.fields);
        status(201);
        return json({ success: true, message: 'Service created successfully.', item });
      } catch (err) {
        console.error('POST /api/admin/services failed:', err.message);
        return status(500), json({ success: false, message: 'Failed to create service. Please try again.' });
      }
    });
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  status(405);
  return json({ success: false, message: 'Method not allowed.' });
};
