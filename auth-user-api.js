// Shared handler factory for the user-auth API endpoints (Task 4).
// Used by both serve.js (local Node server) and api/*.js (Vercel serverless),
// exactly like the existing content API. Every DB touch goes through auth-user-core.js.

const cc = require('./content-core');
const auc = require('./auth-user-core');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function withDbPath(req) {
  return process.env.DATABASE_PATH || 'talora.db';
}

// POST /api/auth/register
async function register(req, res) {
  if ((req.method || 'POST').toUpperCase() !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!auc.rateLimit('reg:' + auc.clientIp(req), 5)) {
    return json(res, 429, { error: 'Too many attempts. Please try again later.' });
  }
  let chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  try {
    const db = cc.createDb(withDbPath(req));
    try {
      const result = await auc.registerUser(db, body);
      if (!result.ok) return json(res, result.status, { error: result.message, field: result.field });
      return json(res, 201, { ok: true, message: 'Account created successfully. You can now log in.', user: result.user });
    } finally { if (db.close) db.close(); }
  } catch (err) {
    console.error('register error:', err);
    return json(res, 500, { error: 'Unable to create account. Please try again.' });
  }
}

// POST /api/auth/user-login
async function login(req, res) {
  if ((req.method || 'POST').toUpperCase() !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  if (!auc.rateLimit('login:' + auc.clientIp(req))) {
    return json(res, 429, { error: 'Too many attempts. Please try again later.' });
  }
  let chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  try {
    const db = cc.createDb(withDbPath(req));
    try {
      const result = await auc.loginUser(db, body);
      if (!result.ok) return json(res, result.status, { error: result.message });
      return json(res, 200, {
        ok: true,
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user
      });
    } finally { if (db.close) db.close(); }
  } catch (err) {
    console.error('login error:', err);
    return json(res, 500, { error: 'Unable to log in. Please try again.' });
  }
}

// GET /api/user/profile  (protected — requires a valid user bearer token)
// PUT /api/user/profile (protected — updates the token's own profile; identity from token only)
async function profile(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'PUT') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const db = cc.createDb(withDbPath(req));
    try {
      const payload = auc.verifyUserToken(req);
      if (!payload || await auc.isUserTokenRevoked(db, auc.extractBearer(req))) {
        return json(res, 401, { error: 'Unauthorized.' });
      }
      if (method === 'GET') {
        const user = await auc.getUserById(db, payload.sub);
        if (!user) return json(res, 401, { error: 'Unauthorized.' });
        return json(res, 200, { ok: true, user });
      }
      let chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      const result = await auc.updateUserProfile(db, payload.sub, body);
      if (!result.ok) return json(res, result.status, { error: result.message, field: result.field });
      return json(res, 200, { ok: true, message: 'Profile updated successfully.', user: result.user });
    } finally { if (db.close) db.close(); }
  } catch (err) {
    console.error('profile error:', err);
    return json(res, 500, { error: 'Unable to update your profile. Please try again.' });
  }
}

// POST /api/auth/logout — revokes the presented token in the database so it
// can no longer be used, even though tokens are stateless HMAC tokens.
async function logout(req, res) {
  if ((req.method || 'POST').toUpperCase() !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const token = auc.extractBearer(req);
    const db = cc.createDb(withDbPath(req));
    try {
      await auc.revokeUserToken(db, token);
    } finally { if (db.close) db.close(); }
  } catch (err) {
    console.error('logout error:', err);
    return json(res, 500, { error: 'Unable to log out. Please try again.' });
  }
  return json(res, 200, { ok: true, message: 'Logged out.' });
}

// GET /api/auth/me — dual-aware: user token => user profile, admin token => admin info,
// no token / invalid token => 401. Keeps the existing CMS (admin) behavior intact.
async function me(req, res) {
  if ((req.method || 'GET').toUpperCase() !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const userPayload = auc.verifyUserToken(req);
    if (userPayload) {
      const user = await auc.getUserFromRequest(req);
      if (user) return json(res, 200, { ok: true, kind: 'user', user });
      return json(res, 401, { error: 'Unauthorized.' });
    }
    // Fall back to admin verification so the existing CMS keeps working.
    try {
      const admin = require('./content-core').verifyAuth(req);
      if (admin) return json(res, 200, { ok: true, kind: 'admin', admin });
    } catch { /* admin path failed — fall through to 401 */ }
    return json(res, 401, { error: 'Unauthorized.' });
  } catch (err) {
    console.error('me error:', err);
    return json(res, 500, { error: 'Unable to determine session.' });
  }
}

module.exports = { register, login, profile, logout, me };
