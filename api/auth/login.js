// Vercel serverless: POST /api/auth/login
// Validates admin credentials against env vars and issues a signed, expiring bearer token.
const { login } = require('../../content-core');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const status = (c) => (typeof res.status === 'function' ? res.status(c) : (res.statusCode = c, res));
  const json = (o) => (typeof res.json === 'function' ? res.json(o) : res.end(JSON.stringify(o)));

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return status(405), json({ success: false, message: 'Method not allowed.' });
  }

  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
  req.on('end', () => {
    const result = login(body);
    if (result.ok) {
      status(200);
      return json({ success: true, message: 'Signed in successfully.', token: result.token, expiresAt: result.expiresAt });
    }
    status(result.status);
    return json({ success: false, message: result.message });
  });
};
