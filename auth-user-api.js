// Shared handler factory for the user-auth API endpoints (Task 4).
// Used by both serve.js (local Node server) and api/*.js (Vercel serverless),
// exactly like the existing content API. Every DB touch goes through auth-user-core.js.

const cc = require('./content-core');
const auc = require('./auth-user-core');
const rbac = require('./rbac-core');

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
    } finally { if (db && db.close) db.close(); }
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
    } finally { if (db && db.close) db.close(); }
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
      // Identity always comes from the signed user token. An admin token (or any
      // other credential) is not a registered user, so it is rejected with 401.
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
    } finally { if (db && db.close) db.close(); }
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
    } finally { if (db && db.close) db.close(); }
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

// GET  /api/admin/users  — list accounts with their roles (ADMIN only)
// PUT  /api/admin/users/:id — change an account's role (ADMIN only)
// The caller is never taken from the request: an EMPLOYEE always receives 403,
// and no endpoint lets a user modify their OWN role.
async function adminUsers(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = (req.url || '').split('?')[0];
  const m = /^\/api\/admin\/users\/(.+)$/.exec(rawUrl);
  const id = m ? decodeURIComponent(m[1]) : null;

  // Only GET (list) and PUT (change role) are supported. Anything else is 405.
  if (method !== 'GET' && method !== 'PUT') return json(res, 405, { error: 'Method not allowed.' });
  if (method === 'GET' && id) return json(res, 405, { error: 'Method not allowed.' });
  if (method === 'PUT' && !id) return json(res, 405, { error: 'Method not allowed.' });

  try {
    const db = cc.createDb(withDbPath(req));
    try {
      // RBAC: 401 without a session, 403 for an authenticated non-admin.
      const principal = await rbac.requireRole(req, res, rbac.ROLES.ADMIN, { db });
      if (!principal) return;
      if (method === 'GET') {
        const users = await auc.listUsers(db, {});
        return json(res, 200, { ok: true, users });
      }
      let chunks = [];
      for await (const c of req) chunks.push(c);
      const result = await auc.updateUserRole(db, id, Buffer.concat(chunks).toString('utf8'));
      if (!result.ok) return json(res, result.status, { error: result.message });
      return json(res, 200, { ok: true, message: 'Role updated successfully.', user: result.user });
    } finally { if (db && db.close) db.close(); }
  } catch (err) {
    console.error('adminUsers error:', err);
    return json(res, 500, { error: 'Unable to manage users. Please try again.' });
  }
}

module.exports = { register, login, profile, logout, me, adminUsers };
