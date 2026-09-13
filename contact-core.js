// Shared contact-inquiry logic used by both:
//   - serve.js (local Node server:  POST /api/contact)
//   - api/contact.js (Vercel serverless function)
// Database: PostgreSQL (hosted, e.g. Neon) when DATABASE_URL / POSTGRES_URL is set;
// falls back to local SQLite via better-sqlite3 for local development.

const path = require('path');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

// ---- SQLite (local development) ----
function createDb(dbFile) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

// ---- PostgreSQL (production, hosted) ----
let pgPool = null;
function getPool() {
  if (!pgPool) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: pgConnectionString(), max: 3, ssl: { rejectUnauthorized: false } });
  }
  return pgPool;
}

async function ensurePgTable() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS inquiries (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

// Validate + store. Returns { ok: true, id } or { ok: false, message }.
// Never throws DB details to the caller.
async function validateAndStore(db, body) {
  let data;
  try { data = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {}); } catch { data = null; }
  if (!data || typeof data !== 'object') {
    return { ok: false, status: 400, message: 'Please provide valid name, email, subject, and message.' };
  }

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
  const message = typeof data.message === 'string' ? data.message.trim() : '';

  if (!name || !subject || !message || !email || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, message: 'Please provide valid name, email, subject, and message.' };
  }

  try {
    if (pgConnectionString()) {
      await ensurePgTable();
      const res = await getPool()
        .query('INSERT INTO inquiries (name, email, subject, message) VALUES ($1, $2, $3, $4) RETURNING id',
          [name, email, subject, message]);
      return { ok: true, status: 201, id: res.rows[0].id };
    }
    const info = db.prepare('INSERT INTO inquiries (name, email, subject, message) VALUES (?, ?, ?, ?)')
      .run(name, email, subject, message);
    return { ok: true, status: 201, id: info.lastInsertRowid };
  } catch (err) {
    // Never expose database errors to the client
    console.error('DB insert failed:', err.message);
    return { ok: false, status: 500, message: 'Unable to send your message. Please try again.' };
  }
}

module.exports = { EMAIL_RE, createDb, validateAndStore, pgConnectionString, dbPath: (f) => path.join(__dirname, f) };
