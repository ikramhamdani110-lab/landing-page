const { updateRequestStatus, createDb } = require('../../../requests-core');
const { verifyAuth } = require('../../../content-core');

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
  const parts = pathname.split('/').filter(Boolean);
  const id = parts[1] || null;
  const method = (req.method || 'PATCH').toUpperCase();

  if (!id) return json(res, 404, { success: false, message: 'Request not found.' });
  if (!verifyAuth(req)) return json(res, 401, { success: false, message: 'You are not authorized to update requests.' });
  if (method !== 'PATCH') return json(res, 405, { success: false, message: 'Method not allowed.' });

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 200000) req.destroy(); });
  req.on('end', async () => {
    let parsed = {};
    try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
    const result = await updateRequestStatus(getDb(), id, parsed.status);
    if (!result.ok) return json(res, result.status || 400, { success: false, message: result.message });
    return json(res, 200, { success: true, message: 'Request status updated.', request: result });
  });
};
