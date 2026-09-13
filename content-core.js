// Shared content-CMS + admin-auth logic, following the same pattern as contact-core.js:
//   - serve.js (local Node server)
//   - api/*.js (Vercel serverless functions)
// Database: PostgreSQL (hosted, e.g. Neon) when DATABASE_URL / POSTGRES_URL is set;
// falls back to local SQLite via better-sqlite3 for local development.
//
// Auth: stateless admin token — base64url(payload).signature where
// signature = HMAC-SHA256(payload, ADMIN_TOKEN_SECRET). Credentials come from env:
//   ADMIN_USERNAME (default "admin"), ADMIN_PASSWORD (default "talora-admin"),
//   ADMIN_TOKEN_SECRET (default derived from ADMIN_PASSWORD — set a real secret in prod).

const crypto = require('crypto');

const CATEGORIES = ['Update', 'Project', 'Certification', 'Skill', 'Achievement', 'Experience', 'General'];
// Website sections this content can belong to (used by the public site to pull managed content)
const SECTIONS = ['Hero', 'Studio Ecosystem', 'Talent', 'Project', 'Match', 'Build', 'Deliver', 'Earn', 'Grow',
  'Build With TALORA', 'Design', 'Engineering', 'Creative Technology', 'Strategy', 'Join TALORA',
  'Grow & Earn', 'Contact', 'Updates', 'General'];
const STATUSES = ['published', 'draft'];
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ---------- Database ----------
function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function createDb(dbFile) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    section TEXT NOT NULL DEFAULT 'General',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // Migration for pre-existing databases: add the section column if missing
  try { db.exec("ALTER TABLE content ADD COLUMN section TEXT NOT NULL DEFAULT 'General'"); } catch (e) { /* column already exists */ }
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
  await getPool().query(`CREATE TABLE IF NOT EXISTS content (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    section TEXT NOT NULL DEFAULT 'General',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  try { await getPool().query("ALTER TABLE content ADD COLUMN section TEXT NOT NULL DEFAULT 'General'"); } catch (e) { /* column already exists */ }
}

// Row -> API shape (normalize timestamps to ISO strings)
function shapeRow(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    status: r.status,
    section: r.section || 'General',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null
  };
}

// ---------- Validation ----------
// Returns { ok: true, fields: {...} } or { ok: false, status, message }
function validateContent(data) {
  // Accept a raw request-body string (like contact-core's validateAndStore) or a parsed object
  if (typeof data === 'string') {
    try { data = JSON.parse(data || '{}'); } catch { data = null; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, message: 'Invalid request body. Please provide title, description, category, and status.' };
  }
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const category = typeof data.category === 'string' ? data.category.trim() : '';
  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
  const section = typeof data.section === 'string' && data.section.trim() ? data.section.trim() : 'General';

  if (!title) return { ok: false, status: 400, message: 'Title is required.' };
  if (title.length > 200) return { ok: false, status: 400, message: 'Title must be 200 characters or fewer.' };
  if (!description) return { ok: false, status: 400, message: 'Content / description is required.' };
  if (description.length > 10000) return { ok: false, status: 400, message: 'Description must be 10,000 characters or fewer.' };
  if (!category || !CATEGORIES.includes(category)) {
    return { ok: false, status: 400, message: 'Category is required and must be one of: ' + CATEGORIES.join(', ') + '.' };
  }
  if (!status || !STATUSES.includes(status)) {
    return { ok: false, status: 400, message: 'Status is required and must be either "published" or "draft".' };
  }
  if (!SECTIONS.includes(section)) {
    return { ok: false, status: 400, message: 'Section must be one of: ' + SECTIONS.join(', ') + '.' };
  }
  return { ok: true, fields: { title, description, category, status, section } };
}

// ---------- CRUD ----------
async function listContent(db, { category, status, search, section } = {}) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const where = []; const params = [];
    if (category && CATEGORIES.includes(category)) { where.push('category = $' + (params.length + 1)); params.push(category); }
    if (status && STATUSES.includes(status)) { where.push('status = $' + (params.length + 1)); params.push(status); }
    if (search) { where.push(`(title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`); params.push('%' + search + '%'); }
    if (section && SECTIONS.includes(section)) { where.push('section = $' + (params.length + 1)); params.push(section); }
    const sql = 'SELECT * FROM content' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated_at DESC, id DESC';
    const res = await getPool().query(sql, params);
    return res.rows.map(shapeRow);
  }
  let sql = 'SELECT * FROM content'; const conds = []; const params = [];
  if (category && CATEGORIES.includes(category)) { conds.push('category = ?'); params.push(category); }
  if (status && STATUSES.includes(status)) { conds.push('status = ?'); params.push(status); }
  if (search) { conds.push('(title LIKE ? OR description LIKE ?)'); params.push('%' + search + '%', '%' + search + '%'); }
  if (section && SECTIONS.includes(section)) { conds.push('section = ?'); params.push(section); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY updated_at DESC, id DESC';
  return db.prepare(sql).all(...params).map(shapeRow);
}

async function getContent(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('SELECT * FROM content WHERE id = $1', [numericId]);
    return res.rows[0] ? shapeRow(res.rows[0]) : null;
  }
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(numericId);
  return row ? shapeRow(row) : null;
}

async function createContent(db, fields) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool()
      .query('INSERT INTO content (title, description, category, status, section) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [fields.title, fields.description, fields.category, fields.status, fields.section]);
    return shapeRow(res.rows[0]);
  }
  const info = db.prepare('INSERT INTO content (title, description, category, status, section) VALUES (?, ?, ?, ?, ?)')
    .run(fields.title, fields.description, fields.category, fields.status, fields.section);
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(info.lastInsertRowid);
  return shapeRow(row);
}

async function updateContent(db, id, fields) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool()
      .query('UPDATE content SET title = $1, description = $2, category = $3, status = $4, section = $5, updated_at = now() WHERE id = $6 RETURNING *',
        [fields.title, fields.description, fields.category, fields.status, fields.section, numericId]);
    return res.rows[0] ? shapeRow(res.rows[0]) : null;
  }
  const info = db.prepare(`UPDATE content SET title = ?, description = ?, category = ?, status = ?, section = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(fields.title, fields.description, fields.category, fields.status, fields.section, numericId);
  if (info.changes === 0) return null;
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(numericId);
  return shapeRow(row);
}

async function deleteContent(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('DELETE FROM content WHERE id = $1', [numericId]);
    return res.rowCount > 0;
  }
  const info = db.prepare('DELETE FROM content WHERE id = ?').run(numericId);
  return info.changes > 0;
}

// ---------- Auth ----------
function adminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'talora-admin'
  };
}

function tokenSecret() {
  return process.env.ADMIN_TOKEN_SECRET || ('talora-fallback-secret::' + adminCredentials().password);
}

function sign(payload) {
  return crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
}

function issueToken() {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp: expiry, sub: 'talora-admin' })).toString('base64url');
  return { token: payload + '.' + sign(payload), expiresAt: expiry };
}

// Returns true if the Authorization header carries a valid, unexpired admin token.
function verifyAuth(req) {
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

// Returns { ok: true, token, expiresAt } or { ok: false, status: 401, message }
function login(body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {}); } catch { data = null; }
  const username = data && typeof data.username === 'string' ? data.username.trim() : '';
  const password = typeof (data && data.password) === 'string' ? data.password : '';
  const creds = adminCredentials();
  if (username !== creds.username || password !== creds.password) {
    return { ok: false, status: 401, message: 'Invalid username or password.' };
  }
  const { token, expiresAt } = issueToken();
  return { ok: true, token, expiresAt };
}

module.exports = {
  CATEGORIES, SECTIONS, STATUSES,
  pgConnectionString, createDb,
  validateContent, listContent, getContent, createContent, updateContent, deleteContent,
  adminCredentials, verifyAuth, login
};
