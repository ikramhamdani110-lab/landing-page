// Vercel serverless: /api/admin/services/:id (admin token required)
//   GET    — fetch one service (for the edit form)
//   PUT    — update a service
//   PATCH  — update a service
//   DELETE — delete a service
const { pgConnectionString, verifyAuth, getService, updateService, deleteService, validateService } = require('../../../services-core');

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

  const m = /^\/api\/admin\/services\/(.+)$/.exec((req.url || '').split('?')[0]);
  const id = m ? decodeURIComponent(m[1]) : null;

  if (req.method === 'GET') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    try {
      const item = await getService(getDb(), id);
      if (!item) return status(404), json({ success: false, message: 'Service not found.' });
      return status(200), json({ success: true, item });
    } catch (err) {
      console.error('GET /api/admin/services/:id failed:', err.message);
      return status(500), json({ success: false, message: 'Failed to load service. Please try again.' });
    }
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', async () => {
      const v = validateService(body);
      if (!v.ok) { status(v.status); return json({ success: false, message: v.message }); }
      try {
        const item = await updateService(getDb(), id, v.fields);
        if (!item) return status(404), json({ success: false, message: 'Service not found.' });
        return status(200), json({ success: true, message: 'Service updated successfully.', item });
      } catch (err) {
        console.error('PUT /api/admin/services/:id failed:', err.message);
        return status(500), json({ success: false, message: 'Failed to update service. Please try again.' });
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    try {
      const deleted = await deleteService(getDb(), id);
      if (!deleted) return status(404), json({ success: false, message: 'Service not found.' });
      return status(200), json({ success: true, message: 'Service deleted successfully.' });
    } catch (err) {
      console.error('DELETE /api/admin/services/:id failed:', err.message);
      return status(500), json({ success: false, message: 'Failed to delete service. Please try again.' });
    }
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  status(405);
  return json({ success: false, message: 'Method not allowed.' });
};
