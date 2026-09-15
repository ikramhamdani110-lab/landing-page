// Vercel serverless: GET /api/auth/me — dual-aware: returns admin or normal user session info.
const { verifyAuth, adminCredentials } = require('../../content-core');
const { getUserFromRequest } = require('../../auth-user-core');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const status = (c) => (typeof res.status === 'function' ? res.status(c) : (res.statusCode = c, res));
  const json = (o) => (typeof res.json === 'function' ? res.json(o) : res.end(JSON.stringify(o)));

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return status(405), json({ success: false, message: 'Method not allowed.' });
  }
  // Try a normal user token first.
  const user = await getUserFromRequest(req);
  if (user) {
    status(200);
    return json({ success: true, user: { id: user.id, fullName: user.full_name, email: user.email, role: 'user' } });
  }
  if (!verifyAuth(req)) {
    return status(401), json({ success: false, message: 'You are not authorized to perform this action.' });
  }
  status(200);
  return json({ success: true, user: { username: adminCredentials().username, role: 'admin' } });
};
