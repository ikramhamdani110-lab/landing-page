// User registration + authentication logic (Task 4), same dual-backend pattern as content-core.js:
//   - serve.js (local Node server, SQLite via better-sqlite3)
//   - api/*.js (Vercel serverless, PostgreSQL via DATABASE_URL / POSTGRES_URL)
//
// Password security: Node built-in scrypt (N=16384, r=8, p=1) with a random 16-byte salt.
// Stored format: scrypt$N$r$p$<salt-hex>$<hash-hex>  — plaintext is never stored or returned.
//
// User tokens: stateless HMAC-SHA256 bearer tokens, same scheme as admin tokens but signed
// with USER_TOKEN_SECRET (separate secret => a user token can never verify as admin and
// vice versa). Payload: { sub: <userId>, role: 'user', exp }. Role is signed, never trusted
// from the request body.

const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USER_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------- Database ----------
function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function createDb(dbFile) {
  // On Vercel there is no writable filesystem, so SQLite can never be used there.
  // Prefer Postgres whenever a connection string exists; only fall back to
  // better-sqlite3 for local development (where the module is installed).
  if (pgConnectionString() || process.env.VERCEL === '1') {
    return null; // callers use the async pg path; db object is not needed
  }
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    signup_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
    // Migration for pre-existing local SQLite databases created before signup_type existed
  const _cols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
  if (!_cols.includes('signup_type')) { db.exec(`ALTER TABLE users ADD COLUMN signup_type TEXT`); }
  db.exec(`CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`);
  return db;
}

let pgPool = null;
function getPool() {
  if (!pgPool) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: pgConnectionString(), max: 3, ssl: { rejectUnauthorized: false } });
  }
  return pgPool;
}

async function ensurePgTable() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await getPool().query(`CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_hash TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  )`);
  await getPool().query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_type TEXT NOT NULL DEFAULT 'project'`);
}

// Safe public shape — NEVER includes password_hash
function shapeUser(r) {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    signupType: r.signup_type || 'project',
    role: r.role,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null
  };
}

// ---------- Password hashing (scrypt) ----------
function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: +N, r: +r, p: +p });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

// ---------- Validation ----------
// Returns { ok: true, fields } or { ok: false, status, message, field? }
function validateRegistration(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data || '{}'); } catch { data = null; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, message: 'Invalid request body.' };
  }
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const fullName = str(data.fullName || data.full_name);
  if (!fullName) return { ok: false, status: 400, message: 'Full name is required.', field: 'fullName' };
  if (fullName.length < 2 || fullName.length > 100) {
    return { ok: false, status: 400, message: 'Full name must be between 2 and 100 characters.', field: 'fullName' };
  }

  const email = str(data.email).toLowerCase();
  if (!email) return { ok: false, status: 400, message: 'Email is required.', field: 'email' };
  if (email.length > 200 || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, message: 'Please enter a valid email address.', field: 'email' };
  }

  const password = typeof data.password === 'string' ? data.password : '';
  if (!password) return { ok: false, status: 400, message: 'Password is required.', field: 'password' };
  if (password.length < 8) return { ok: false, status: 400, message: 'Password must be at least 8 characters.', field: 'password' };
  if (password.length > 128) return { ok: false, status: 400, message: 'Password must be 128 characters or fewer.', field: 'password' };

  const confirmPassword = typeof data.confirmPassword === 'string' ? data.confirmPassword : '';
  if (password !== confirmPassword) {
    return { ok: false, status: 400, message: 'Passwords do not match.', field: 'confirmPassword' };
  }

  return { ok: true, fields: { fullName, email, password } };
}

// ---------- Registration ----------
// Returns { ok: true, user } or { ok: false, status, message, field? }
async function registerUser(db, body) {
  const v = validateRegistration(body);
  if (!v.ok) return v;
  const { fullName, email, password } = v.fields;
  const signupType = body && body.signupType === 'talent' ? 'talent' : 'project';
  const passwordHash = hashPassword(password); // role is NOT taken from the request — always 'user'

  try {
    if (pgConnectionString()) {
      await ensurePgTable();
      const dup = await getPool().query('SELECT id FROM users WHERE email = $1', [email]);
      if (dup.rows.length) return { ok: false, status: 409, message: 'An account with this email already exists.', field: 'email' };
      const res = await getPool()
        .query("INSERT INTO users (full_name, email, password_hash, role, signup_type) VALUES ($1, $2, $3, 'user', $4) RETURNING *",
          [fullName, email, passwordHash, signupType]);
      return { ok: true, user: shapeUser(res.rows[0]) };
    }
    const dup = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (dup) return { ok: false, status: 409, message: 'An account with this email already exists.', field: 'email' };
    const info = db.prepare("INSERT INTO users (full_name, email, password_hash, role, signup_type) VALUES (?, ?, ?, 'user', ?)")
      .run(fullName, email, passwordHash, signupType);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    return { ok: true, user: shapeUser(row) };
  } catch (err) {
    if (String(err.message).includes('UNIQUE') || err.code === '23505' || err.code === '23514') {
      return { ok: false, status: 409, message: 'An account with this email already exists.', field: 'email' };
    }
    throw err;
  }
}

// ---------- Login ----------
// Returns { ok: true, user, token, expiresAt } or { ok: false, status: 401, message }
// Generic error message — does not reveal whether the email or password was wrong.
async function loginUser(db, body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {}); } catch { data = null; }
  const email = data && typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = data && typeof data.password === 'string' ? data.password : '';
  if (!email || !password) {
    return { ok: false, status: 400, message: 'Email and password are required.' };
  }
  if (email.length > 200 || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, message: 'Please enter a valid email address.' };
  }

  let row;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('SELECT * FROM users WHERE email = $1', [email]);
    row = res.rows[0];
  } else {
    row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }
  if (!row || !verifyPassword(password, row.password_hash)) {
    return { ok: false, status: 401, message: 'Invalid email or password.' };
  }
  const { token, expiresAt } = issueUserToken(row.id);
  return { ok: true, user: shapeUser(row), token, expiresAt };
}

// ---------- Profile update (Task 5) ----------
// Only permitted fields can change: full_name and email. Identity always comes
// from the authenticated token (userId), never from the request body. Protected
// columns (id, password_hash, role, created_at) are never accepted from input.
// Returns { ok: true, user } or { ok: false, status, message, field? }
async function updateUserProfile(db, userId, body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {}); } catch { data = null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, message: 'Invalid request body.' };
  }
  // Ignore anything that is not an allowed field — including id, role, password etc.
  const fullName = typeof (data.fullName ?? data.full_name) === 'string' ? (data.fullName ?? data.full_name).trim() : undefined;
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : undefined;

  if (fullName !== undefined && (fullName.length < 2 || fullName.length > 100)) {
    return { ok: false, status: 400, message: 'Full name must be between 2 and 100 characters.', field: 'fullName' };
  }
  if (email !== undefined && (email.length > 200 || !EMAIL_RE.test(email))) {
    return { ok: false, status: 400, message: 'Please enter a valid email address.', field: 'email' };
  }
  if (fullName === undefined && email === undefined) {
    return { ok: false, status: 400, message: 'Nothing to update.' };
  }

  try {
    if (pgConnectionString()) {
      await ensurePgTable();
      if (email !== undefined) {
        const dup = await getPool().query('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, userId]);
        if (dup.rows.length) return { ok: false, status: 409, message: 'An account with this email already exists.', field: 'email' };
      }
      const sets = [], vals = [];
      if (fullName !== undefined) { sets.push(`full_name = $${vals.length + 1}`); vals.push(fullName); }
      if (email !== undefined) { sets.push(`email = $${vals.length + 1}`); vals.push(email); }
      sets.push(`updated_at = now()`);
      const res = await getPool().query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length + 1} RETURNING *`, [...vals, userId]);
      if (!res.rows.length) return { ok: false, status: 404, message: 'Account not found.' };
      return { ok: true, user: shapeUser(res.rows[0]) };
    }
    if (email !== undefined) {
      const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, userId);
      if (dup) return { ok: false, status: 409, message: 'An account with this email already exists.', field: 'email' };
    }
    const sets = [], vals = [];
    if (fullName !== undefined) { sets.push('full_name = ?'); vals.push(fullName); }
    if (email !== undefined) { sets.push('email = ?'); vals.push(email); }
    sets.push("updated_at = datetime('now')");
    const info = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, userId);
    if (!info.changes) return { ok: false, status: 404, message: 'Account not found.' };
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return { ok: true, user: shapeUser(row) };
  } catch (err) {
    if (String(err.message).includes('UNIQUE') || err.code === '23505') {
      return { ok: false, status: 409, message: 'An account with this email already exists.', field: 'email' };
    }
    throw err;
  }
}

// ---------- User tokens (separate secret from admin tokens) ----------
const USER_IS_PROD = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

class MissingUserSecretError extends Error {}

function userTokenSecret() {
  const s = process.env.USER_TOKEN_SECRET;
  if (s) return s;
  if (USER_IS_PROD) {
    throw new MissingUserSecretError('USER_TOKEN_SECRET environment variable is not set. User authentication is disabled until it is configured in production.');
  }
  return 'talora-user-secret::' + (process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASSWORD || 'talora-admin'); // local dev only
}

function signUser(payload) {
  return crypto.createHmac('sha256', userTokenSecret()).update(payload).digest('base64url');
}

function issueUserToken(userId) {
  const expiry = Date.now() + USER_TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'user', exp: expiry })).toString('base64url');
  return { token: payload + '.' + signUser(payload), expiresAt: expiry };
}

// ---------- Token revocation (DB-backed, so logout truly invalidates a session) ----------
// Only a SHA-256 hash of the token is stored - never the token itself.
function extractBearer(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!header || typeof header !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function revokeUserToken(db, token) {
  if (!token) return;
  const hash = tokenHash(token);
  const expiresAt = Date.now() + USER_TOKEN_TTL_MS;
  try {
    if (pgConnectionString()) {
      await ensurePgTable();
      await getPool().query(
        'INSERT INTO revoked_tokens (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT (token_hash) DO NOTHING',
        [hash, expiresAt]);
    } else {
      db.prepare('INSERT OR IGNORE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)').run(hash, expiresAt);
    }
  } catch (e) { console.error('revokeUserToken error:', e.message); }
}

async function isUserTokenRevoked(db, token) {
  if (!token) return false;
  const hash = tokenHash(token);
  try {
    if (pgConnectionString()) {
      await ensurePgTable();
      await getPool().query('DELETE FROM revoked_tokens WHERE expires_at < $1', [Date.now() - USER_TOKEN_TTL_MS]);
      const res = await getPool().query('SELECT 1 FROM revoked_tokens WHERE token_hash = $1', [hash]);
      return res.rows.length > 0;
    }
    db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Date.now() - USER_TOKEN_TTL_MS);
    return !!db.prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?').get(hash);
  } catch (e) { console.error('isUserTokenRevoked error:', e.message); return false; }
}

// Returns the signed payload { sub, role, exp } for a valid, unexpired USER token, else null.
function verifyUserToken(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!header || typeof header !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 2) return null;
  const expected = signUser(parts[0]);
  const a = Buffer.from(expected), b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (payload.role !== 'user' || typeof payload.sub !== 'number' || typeof payload.exp !== 'number') return null;
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

// Resolve the authenticated user from a request's bearer token, or null.
// Rejects tokens that have been revoked via /api/auth/logout.
async function getUserFromRequest(req) {
  const payload = verifyUserToken(req);
  if (!payload) return null;
  try {
    const db = createDb(process.env.DATABASE_PATH || 'talora.db');
    try {
      if (await isUserTokenRevoked(db, extractBearer(req))) return null;
      return await getUserById(db, payload.sub);
    } finally { if (db.close) db.close(); }
  } catch (e) {
    return null;
  }
}

// Fetch the safe profile of the token's user straight from the database.
async function getUserById(db, id) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ? shapeUser(res.rows[0]) : null;
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? shapeUser(row) : null;
}

// ---------- Rate limiting (best effort; in-memory per instance) ----------
const attempts = new Map(); // key -> [timestamps]
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10) || 15 * 60 * 1000;
const MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_MAX || '', 10) || 10;

function rateLimit(key, max = MAX_ATTEMPTS, windowMs = WINDOW_MS) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { attempts.set(key, list); return false; }
  list.push(now);
  attempts.set(key, list);
  return true;
}

function clientIp(req) {
  const xf = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  return (typeof xf === 'string' ? xf.split(',')[0].trim() : '') || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = {
  pgConnectionString, createDb,
  validateRegistration, registerUser, loginUser, updateUserProfile,
  hashPassword, verifyPassword,
  issueUserToken, verifyUserToken, getUserById, getUserFromRequest,
  extractBearer, revokeUserToken, isUserTokenRevoked,
  rateLimit, clientIp
};
