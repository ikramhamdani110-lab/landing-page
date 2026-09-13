// Vercel serverless: GET /api/auth/me — verifies the bearer token of the current admin session.
const { verifyAuth, adminCredentials } = require('../../content-core');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const status = (c) => (typeof res.status === 'function' ? res.status(c) : (res.statusCode = c, res));
  const json = (o) => (typeof res.json === 'function' ? res.json(o) : res.end(JSON.stringify(o)));

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return status(405), json({ success: false, message: 'Method not allowed.' });
  }
  if (!verifyAuth(req)) {
    return status(401), json({ success: false, message: 'You are not authorized to perform this action.' });
  }
  status(200);
  return json({ success: true, user: { username: adminCredentials().username, role: 'admin' } });
};
