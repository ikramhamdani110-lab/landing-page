// Vercel Serverless Function: POST /api/contact
// Production database: hosted PostgreSQL (Neon) via DATABASE_URL / POSTGRES_URL env vars.
// Falls back to SQLite in /tmp only when no hosted DB is configured (local emulation).

const { createDb, validateAndStore } = require('../contact-core');

let db = null;
function getDb() {
  if (!db && !process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    const path = require('path');
    db = createDb(process.env.DATABASE_PATH || path.join('/tmp', 'talora.db'));
  }
  return db;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // Fallbacks so the handler also runs under plain Node http (local shim/testing)
  const status = (c) => (typeof res.status === 'function' ? res.status(c) : (res.statusCode = c, res));
  const json = (o) => (typeof res.json === 'function' ? res.json(o) : res.end(JSON.stringify(o)));

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    status(405);
    return json({ success: false, message: 'Method not allowed.' });
  }

  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
  req.on('end', async () => {
    const result = await validateAndStore(getDb(), body);
    if (result.ok) {
      status(result.status);
      return json({
        success: true,
        message: 'Your message has been sent successfully.',
        id: result.id
      });
    }
    status(result.status);
    return json({ success: false, message: result.message });
  });
};
