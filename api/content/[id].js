// Vercel serverless: /api/content/:id
//   GET    /api/content/:id — fetch one item (auth required)
//   PUT    /api/content/:id — update item (auth required)
//   PATCH  /api/content/:id — update item (auth required)
//   DELETE /api/content/:id — delete item (auth required)
const { pgConnectionString, verifyAuth, getContent, updateContent, deleteContent, validateContent } = require('../../content-core');

let sqliteDb = null;
function getDb() {
  if (!sqliteDb && !pgConnectionString()) {
    const path = require('path');
    sqliteDb = require('../../content-core').createDb(process.env.DATABASE_PATH || path.join('/tmp', 'talora.db'));
  }
  return sqliteDb;
}

const unauthorized = (status, json) => { status(401); json({ success: false, message: 'You are not authorized to perform this action.' }); };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const status = (c) => (typeof res.status === 'function' ? res.status(c) : (res.statusCode = c, res));
  const json = (o) => (typeof res.json === 'function' ? res.json(o) : res.end(JSON.stringify(o)));

  const m = /^\/api\/content\/(.+)$/.exec((req.url || '').split('?')[0]);
  const id = m ? decodeURIComponent(m[1]) : null;

  if (req.method === 'GET') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    try {
      const item = await getContent(getDb(), id);
      if (!item) return status(404), json({ success: false, message: 'Content not found.' });
      return status(200), json({ success: true, item });
    } catch (err) {
      console.error('GET /api/content/:id failed:', err.message);
      return status(500), json({ success: false, message: 'Failed to load content. Please try again.' });
    }
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', async () => {
      const v = validateContent(body);
      if (!v.ok) { status(v.status); return json({ success: false, message: v.message }); }
      try {
        const item = await updateContent(getDb(), id, v.fields);
        if (!item) return status(404), json({ success: false, message: 'Content not found.' });
        return status(200), json({ success: true, message: 'Content updated successfully.', item });
      } catch (err) {
        console.error('PUT /api/content/:id failed:', err.message);
        return status(500), json({ success: false, message: 'Failed to update content. Please try again.' });
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    try {
      const deleted = await deleteContent(getDb(), id);
      if (!deleted) return status(404), json({ success: false, message: 'Content not found.' });
      return status(200), json({ success: true, message: 'Content deleted successfully.' });
    } catch (err) {
      console.error('DELETE /api/content/:id failed:', err.message);
      return status(500), json({ success: false, message: 'Failed to delete content. Please try again.' });
    }
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  status(405);
  return json({ success: false, message: 'Method not allowed.' });
};
