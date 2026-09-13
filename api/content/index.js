// Vercel serverless: /api/content
//   GET  /api/content        — list content (auth required)
//   POST /api/content        — create content (auth required)
// Production database: hosted PostgreSQL (Neon) via DATABASE_URL / POSTGRES_URL.
// Local SQLite is only used when no hosted DB is configured.
const { pgConnectionString, verifyAuth, listContent, createContent, validateContent } = require('../../content-core');

// Local-dev shim when run under plain Node http without a hosted DB
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

  if (req.method === 'GET') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    try {
      const items = await listContent(getDb(), {
        category: q.get('category'), status: q.get('status'), search: q.get('search'), section: q.get('section')
      });
      return status(200), json({ success: true, items });
    } catch (err) {
      console.error('GET /api/content failed:', err.message);
      return status(500), json({ success: false, message: 'Failed to load content. Please try again.' });
    }
  }

  if (req.method === 'POST') {
    if (!verifyAuth(req)) return unauthorized(status, json);
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', async () => {
      const v = validateContent(body);
      if (!v.ok) { status(v.status); return json({ success: false, message: v.message }); }
      try {
        const item = await createContent(getDb(), v.fields);
        status(201);
        return json({ success: true, message: 'Content created successfully.', item });
      } catch (err) {
        console.error('POST /api/content failed:', err.message);
        return status(500), json({ success: false, message: 'Failed to create content. Please try again.' });
      }
    });
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  status(405);
  return json({ success: false, message: 'Method not allowed.' });
};
