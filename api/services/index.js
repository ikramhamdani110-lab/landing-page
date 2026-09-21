// Vercel serverless: GET /api/services
// Public endpoint — returns ACTIVE services for the public website (no auth).
const { pgConnectionString, listServices } = require('../../services-core');

let sqliteDb = null;
function getDb() {
  if (!sqliteDb && !pgConnectionString()) {
    const path = require('path');
    sqliteDb = require('../../services-core').createDb(process.env.DATABASE_PATH || path.join('/tmp', 'talora.db'));
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

  try {
    const items = await listServices(getDb(), { status: 'active' });
    return status(200), json({ success: true, items });
  } catch (err) {
    console.error('GET /api/services failed:', err.message);
    return status(500), json({ success: false, message: 'Failed to load services.' });
  }
};
