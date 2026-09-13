// Vercel serverless: GET /api/website-content
// Public endpoint — returns the published website content map (no auth).
// Falls back to DEFAULTS for any key not published in the database.
const { pgConnectionString, getSettings } = require('../site-core');

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

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return status(405), json({ success: false, message: 'Method not allowed.' });
  }

  const q = new URLSearchParams(req.url.split('?')[1] || '');
  try {
    const values = await getSettings(getDb(), { publicOnly: true });
    return status(200), json({ success: true, values });
  } catch (err) {
    console.error('GET /api/website-content failed:', err.message);
    return status(500), json({ success: false, message: 'Failed to load website content.' });
  }
};
