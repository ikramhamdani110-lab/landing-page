// TALORA — Services core (Task 6)
// Services shown on the public website ("Build With TALORA" capabilities),
// managed through the admin CMS. Same architecture as content-core:
//   - hosted PostgreSQL (Neon) via DATABASE_URL / POSTGRES_URL in production
//   - local SQLite (better-sqlite3) when no hosted DB is configured
// Public API returns only status='active' rows; the CMS sees all of them.
const crypto = require('crypto');

const STATUSES = ['active', 'inactive'];
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function createDb(dbFile) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  await getPool().query(`CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

// Row -> API shape (normalize timestamps to ISO strings)
function shapeRow(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    icon: r.icon || '',
    status: r.status,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null
  };
}

// ---------- Validation ----------
// Returns { ok: true, fields } or { ok: false, status, message }
function validateService(data) {
  let d;
  try { d = typeof data === 'string' ? JSON.parse(data || '{}') : (data || {}); } catch { d = null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { ok: false, status: 400, message: 'Invalid request body. Please provide title, description, and status.' };
  }
  const title = typeof d.title === 'string' ? d.title.trim() : '';
  const description = typeof d.description === 'string' ? d.description.trim() : '';
  const icon = typeof d.icon === 'string' ? d.icon.trim() : '';
  const status = typeof d.status === 'string' ? d.status.trim() : '';
  if (!title) return { ok: false, status: 400, message: 'Title is required.' };
  if (title.length > 200) return { ok: false, status: 400, message: 'Title must be 200 characters or fewer.' };
  if (!description) return { ok: false, status: 400, message: 'Description is required.' };
  if (description.length > 2000) return { ok: false, status: 400, message: 'Description must be 2,000 characters or fewer.' };
  if (icon.length > 100) return { ok: false, status: 400, message: 'Icon must be 100 characters or fewer.' };
  if (!STATUSES.includes(status)) {
    return { ok: false, status: 400, message: 'Status is required and must be either "active" or "inactive".' };
  }
  return { ok: true, fields: { title, description, icon, status } };
}

// ---------- CRUD ----------
async function listServices(db, { status } = {}) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const where = []; const params = [];
    if (status && STATUSES.includes(status)) { where.push('status = $1'); params.push(status); }
    const sql = 'SELECT * FROM services' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at ASC, id ASC';
    const res = await getPool().query(sql, params);
    return res.rows.map(shapeRow);
  }
  let sql = 'SELECT * FROM services'; const params = [];
  if (status && STATUSES.includes(status)) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY created_at ASC, id ASC';
  return db.prepare(sql).all(...params).map(shapeRow);
}

async function getService(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('SELECT * FROM services WHERE id = $1', [numericId]);
    return res.rows[0] ? shapeRow(res.rows[0]) : null;
  }
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(numericId);
  return row ? shapeRow(row) : null;
}

async function createService(db, fields) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool()
      .query('INSERT INTO services (title, description, icon, status) VALUES ($1, $2, $3, $4) RETURNING *',
        [fields.title, fields.description, fields.icon, fields.status]);
    return shapeRow(res.rows[0]);
  }
  const info = db.prepare('INSERT INTO services (title, description, icon, status) VALUES (?, ?, ?, ?)')
    .run(fields.title, fields.description, fields.icon, fields.status);
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(info.lastInsertRowid);
  return shapeRow(row);
}

async function updateService(db, id, fields) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool()
      .query('UPDATE services SET title = $1, description = $2, icon = $3, status = $4, updated_at = now() WHERE id = $5 RETURNING *',
        [fields.title, fields.description, fields.icon, fields.status, numericId]);
    return res.rows[0] ? shapeRow(res.rows[0]) : null;
  }
  const info = db.prepare(`UPDATE services SET title = ?, description = ?, icon = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(fields.title, fields.description, fields.icon, fields.status, numericId);
  if (info.changes === 0) return null;
  const row = db.prepare('SELECT * FROM services WHERE id = ?').get(numericId);
  return shapeRow(row);
}

async function deleteService(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('DELETE FROM services WHERE id = $1', [numericId]);
    return res.rowCount > 0;
  }
  const info = db.prepare('DELETE FROM services WHERE id = ?').run(numericId);
  return info.changes > 0;
}

// ---------- Auth (reuses the existing admin token system) ----------
// Same secret, same signed-token format as content-core: separate credentials
// or secrets would create a second authentication system — Task 6 must not.
function adminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'talora-admin'
  };
}

const IS_PROD = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

class MissingSecretError extends Error {}

function tokenSecret() {
  const s = process.env.ADMIN_TOKEN_SECRET;
  if (s) return s;
  if (IS_PROD) {
    throw new MissingSecretError('ADMIN_TOKEN_SECRET environment variable is not set. Admin authentication is disabled until it is configured in production.');
  }
  return 'talora-fallback-secret::' + adminCredentials().password; // local dev only
}

function sign(payload) {
  return crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
}

// Returns true if the Authorization header carries a valid, unexpired admin token.
function verifyAuth(req) {
  try {
    return verifyAuthInner(req);
  } catch (e) {
    if (e instanceof MissingSecretError) console.error('verifyAuth:', e.message);
    return false; // misconfigured server: never accept tokens
  }
}

function verifyAuthInner(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!header || typeof header !== 'string') return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 2) return false;
  const expected = sign(parts[0]);
  const a = Buffer.from(expected), b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch { return false; }
}

// Ensure the services table exists in an already-open SQLite database
// (serve.js shares one database file across contact/content/services).
function ensureSqliteTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

// On Vercel there is no writable filesystem and better-sqlite3 is not bundled,
// so expose a null-db creator for serverless: the pg path never touches it.
function createDbServerless() { return null; }

module.exports = {
  STATUSES,
  pgConnectionString, createDb: process.env.VERCEL === '1' ? createDbServerless : createDb,
  ensureSqliteTables,
  validateService, listServices, getService, createService, updateService, deleteService,
  verifyAuth
};
