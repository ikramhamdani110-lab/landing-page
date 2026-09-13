// Vercel serverless: /api/website-settings
//   GET — admin-only: full website content map + section metadata
//   PUT / PATCH — admin-only: save website content changes (auth required)
const { pgConnectionString, getSettings, saveSettings, SECTIONS, DEFAULTS, verifyAdmin } = require('../site-core');

let sqliteDb = null;
function getDb() {
  if (!sqliteDb && !pgConnectionString()) {
    const path = require('path');
    sqliteDb = require('../site-core').createDb(process.env.DATABASE_PATH || path.join('/tmp', 'talora.db'));
  }
  return sqliteDb;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const status = (c) => (typeof res.status === 'function' ? res.status(c) : (res.statusCode = c, res));
  const json = (o) => (typeof res.json === 'function' ? res.json(o) : res.end(JSON.stringify(o)));

  const unauthorized = () => { status(401); return json({ success: false, message: 'You are not authorized to perform this action.' }); };

  if (!verifyAdmin(req)) return unauthorized();

  if (req.method === 'GET') {
    try {
      const values = await getSettings(getDb());
      return status(200), json({ success: true, sections: SECTIONS, values, defaults: DEFAULTS });
    } catch (err) {
      console.error('GET /api/website-settings failed:', err.message);
      return status(500), json({ success: false, message: 'Failed to load website settings.' });
    }
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
    req.on('end', async () => {
      try {
        const result = await saveSettings(getDb(), body);
        if (!result.ok) { status(result.status); return json({ success: false, message: result.message }); }
        const values = await getSettings(getDb());
        return status(200), json({ success: true, message: 'Website content saved successfully.', values });
      } catch (err) {
        console.error('PUT /api/website-settings failed:', err.message);
        return status(500), json({ success: false, message: 'Failed to save website content.' });
      }
    });
    return;
  }

  res.setHeader('Allow', 'GET, PUT, PATCH');
  return status(405), json({ success: false, message: 'Method not allowed.' });
};
