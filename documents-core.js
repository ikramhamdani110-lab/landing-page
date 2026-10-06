// Task 10 — File & Document Management (shared core logic).
// Same dual-backend pattern as requests-core.js / content-core.js:
//   - serve.js (local Node server, SQLite via better-sqlite3)
//   - api/[...path].js (Vercel serverless, PostgreSQL via DATABASE_URL / POSTGRES_URL)
//
// Files are stored on disk (never as DB blobs). The database keeps metadata only:
//   documents(id, user_id, original_filename, stored_filename, mime_type, size_bytes,
//             storage_path, created_at)
// Each document belongs to the authenticated user who uploaded it (User 1->N Document).
//
// Security summary:
//   - authentication is resolved by the caller with auth-user-core.getUserFromRequest()
//     (the existing user token system) or requests-core.isCompanyUser() (admin token);
//     no new token scheme is introduced.
//   - ownership: a user may only see/delete their own rows; an admin token may see
//     everything (Task 9 RBAC: admin has full document:* access, a normal user only
//     manages documents they own).
//   - filenames are never trusted: the original name is stored for display but the file
//     is written under a generated name (uuid + safe extension) inside a fixed uploads
//     directory. No client-controlled path ever reaches the filesystem.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Configuration ----------
const MAX_FILE_BYTES = parseInt(process.env.DOCUMENT_MAX_BYTES || '', 10) || 10 * 1024 * 1024; // 10 MB

// Extension -> canonical MIME type. Validation is dual: the extension AND the
// declared content type must both map into this allow-list (415 otherwise).
const ALLOWED_TYPES = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.txt': ['text/plain'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg']
};
const ALLOWED_MIMES = new Set(Object.values(ALLOWED_TYPES).flat());

// ---------- Database (dual backend) ----------
function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function createDb(dbFile) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)`);
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
  await getPool().query(`CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)`);
}

// Safe public shape — storage_path is the on-disk key only, never a client URL.
function shapeDocument(r) {
  return {
    id: r.id,
    userId: r.user_id,
    originalFilename: r.original_filename,
    storedFilename: r.stored_filename,
    mimeType: r.mime_type,
    size: Number(r.size_bytes),
    storagePath: r.storage_path,
    createdAt: r.created_at ? (typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString()) : null
  };
}

// ---------- Validation ----------
// Returns { ok: true, ... } or { ok: false, status, message }.
// status: 400 missing/malformed, 413 too large, 415 unsupported type.
function validateUpload({ originalFilename, mimeType, size }) {
  if (!originalFilename || typeof originalFilename !== 'string' || !originalFilename.trim()) {
    return { ok: false, status: 400, message: 'Missing file. Please choose a file to upload.' };
  }
  // Base name only: a client-supplied path (or traversal like ../../x.exe) is stripped.
  const base = path.basename(originalFilename).replace(/[\\/\x00-\x1f]/g, '_').trim();
  if (!base || base === '.' || base === '..') {
    return { ok: false, status: 400, message: 'Invalid file name.' };
  }
  const ext = path.extname(base).toLowerCase();
  if (!ext || !ALLOWED_TYPES[ext]) {
    return { ok: false, status: 415, message: 'This file type is not supported. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, PNG, JPG, JPEG.' };
  }
  const mimeOk = typeof mimeType === 'string' &&
    (ALLOWED_MIMES.has(mimeType.toLowerCase()) || mimeType.toLowerCase() === 'application/octet-stream');
  if (!mimeOk) {
    return { ok: false, status: 415, message: 'This file type is not supported.' };
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, message: 'Malformed upload. Please try again.' };
  }
  if (size > MAX_FILE_BYTES) {
    return { ok: false, status: 413, message: `The file is too large. Maximum size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.` };
  }
  return { ok: true, safeName: base };
}

// ---------- Storage ----------
// Uploads directory: local dev -> <project>/uploads ; serverless -> /tmp/uploads
// (Vercel functions have a writable /tmp only). The directory never depends on
// client input, so there is no traversal surface.
function uploadsDir() {
  const dir = process.env.DOCUMENT_UPLOAD_DIR ||
    (process.env.VERCEL === '1' ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Files are stored as <uuid><safe-extension> — the original name is metadata only.
function generateStoredFilename(originalFilename) {
  const ext = path.extname(originalFilename).toLowerCase();
  const safeExt = ALLOWED_TYPES[ext] ? ext : '';
  return crypto.randomBytes(16).toString('hex') + safeExt;
}

function storedFilePath(storedFilename) {
  // Defense in depth: even though stored_filename is always generated internally,
  // clamp it to the uploads directory before it touches the filesystem.
  const dir = uploadsDir();
  const resolved = path.resolve(dir, path.basename(String(storedFilename)));
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) return null;
  return resolved;
}

// ---------- RBAC helpers (Task 9 integration — no new role system) ----------
// Documents follow the existing model: a signed-in user manages their own documents;
// the existing admin/company token is treated as ADMIN role (full document access).
function isAdminPrincipal(principal) {
  return principal && principal.kind === 'admin';
}
function docOwner(doc) {
  return doc && (doc.user_id !== undefined ? doc.user_id : doc.userId);
}
function canView(principal, doc) {
  return isAdminPrincipal(principal) || (docOwner(doc) === principal.userId);
}
function canDelete(principal, doc) {
  return isAdminPrincipal(principal) || (docOwner(doc) === principal.userId);
}

// ---------- Data access ----------
async function insertDocument(db, { userId, originalFilename, storedFilename, mimeType, size, storagePath }) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query(
      `INSERT INTO documents (user_id, original_filename, stored_filename, mime_type, size_bytes, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, originalFilename, storedFilename, mimeType, size, storagePath]
    );
    return shapeDocument(res.rows[0]);
  }
  const info = db.prepare(
    `INSERT INTO documents (user_id, original_filename, stored_filename, mime_type, size_bytes, storage_path)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, originalFilename, storedFilename, mimeType, size, storagePath);
  return shapeDocument(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid));
}

// A user sees only their own documents; an admin sees all.
async function listDocuments(db, principal) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = isAdminPrincipal(principal)
      ? await getPool().query('SELECT * FROM documents ORDER BY created_at DESC, id DESC')
      : await getPool().query('SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC, id DESC', [principal.userId]);
    return res.rows.map(shapeDocument);
  }
  const rows = isAdminPrincipal(principal)
    ? db.prepare('SELECT * FROM documents ORDER BY created_at DESC, id DESC').all()
    : db.prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(principal.userId);
  return rows.map(shapeDocument);
}

async function getDocumentById(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('SELECT * FROM documents WHERE id = $1', [numericId]);
    return res.rows[0] ? shapeDocument(res.rows[0]) : null;
  }
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(numericId);
  return row ? shapeDocument(row) : null;
}

// Deletes the DB row and the physical file. Returns true on success, null when the
// document does not exist. Authorization (canDelete) is checked by the caller BEFORE
// this runs — the id alone never grants access.
async function deleteDocument(db, doc) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('DELETE FROM documents WHERE id = $1 RETURNING *', [doc.id]);
    if (!res.rows[0]) return null;
  } else {
    const info = db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    if (info.changes === 0) return null;
  }
  // Best-effort file removal: even if unlink fails, the row is gone and the orphan
  // file is never reachable through the API.
  try {
    const p = storedFilePath(doc.storedFilename);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.error('documents: failed to remove stored file:', e.message);
  }
  return true;
}

module.exports = {
  MAX_FILE_BYTES,
  ALLOWED_TYPES,
  ALLOWED_MIMES,
  pgConnectionString,
  createDb,
  ensurePgTable,
  shapeDocument,
  validateUpload,
  uploadsDir,
  generateStoredFilename,
  storedFilePath,
  isAdminPrincipal,
  canView,
  canDelete,
  insertDocument,
  listDocuments,
  getDocumentById,
  deleteDocument
};
