const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REQUEST_STATUSES = ['NEW', 'REVIEWING', 'MATCHING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'];
const REQUEST_CATEGORIES = ['Design', 'Web Development', 'Software / Engineering', 'Creative Technology', 'Strategy', 'Other'];
const DEFAULT_STATUS = 'NEW';

function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function createDb(dbFile) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS customer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    company_name TEXT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    budget TEXT,
    deadline TEXT,
    additional_details TEXT,
    status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','REVIEWING','MATCHING','IN_PROGRESS','COMPLETED','REJECTED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_requests_status ON customer_requests(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_requests_created ON customer_requests(created_at DESC)`);
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
  await getPool().query(`CREATE TABLE IF NOT EXISTS customer_requests (
    id SERIAL PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    company_name TEXT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    budget TEXT,
    deadline TEXT,
    additional_details TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'NEW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_customer_requests_status ON customer_requests(status)`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_customer_requests_created ON customer_requests(created_at DESC)`);
}

function shapeRequest(r) {
  return {
    id: r.id,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    companyName: r.company_name,
    category: r.category,
    title: r.title,
    description: r.description,
    budget: r.budget,
    deadline: r.deadline,
    additionalDetails: r.additional_details,
    status: r.status,
    createdAt: r.created_at ? (typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString()) : null,
    updatedAt: r.updated_at ? (typeof r.updated_at === 'string' ? r.updated_at : new Date(r.updated_at).toISOString()) : null
  };
}

function parseBody(input) {
  if (typeof input === 'string') {
    try { return JSON.parse(input || '{}'); } catch { return null; }
  }
  return input && typeof input === 'object' && !Array.isArray(input) ? input : null;
}

function normalizeText(v, maxLength) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (maxLength && s.length > maxLength) return s.slice(0, maxLength).trim();
  return s;
}

function validateRequest(data) {
  const body = parseBody(data);
  if (!body) {
    return { ok: false, status: 400, message: 'Invalid request payload.' };
  }

  const customerName = normalizeText(body.fullName || body.customerName || body.customer_name, 100);
  if (!customerName) return { ok: false, status: 400, message: 'Full name is required.', field: 'fullName' };

  const customerEmail = normalizeText(body.email || body.customerEmail || body.customer_email, 200).toLowerCase();
  if (!customerEmail || !EMAIL_RE.test(customerEmail)) {
    return { ok: false, status: 400, message: 'Please provide a valid email address.', field: 'email' };
  }

  const companyName = normalizeText(body.companyName || body.company_name, 150);
  const category = normalizeText(body.category, 60);
  if (!REQUEST_CATEGORIES.includes(category)) {
    return { ok: false, status: 400, message: 'Please choose a valid service category.', field: 'category' };
  }

  const title = normalizeText(body.title || body.projectTitle || body.project_title, 200);
  if (!title) return { ok: false, status: 400, message: 'Project title is required.', field: 'title' };

  const description = normalizeText(body.description || body.projectDescription || body.project_description, 5000);
  if (!description) return { ok: false, status: 400, message: 'Project description is required.', field: 'description' };

  const budget = normalizeText(body.budget, 80);
  const deadline = normalizeText(body.deadline, 50);
  const additionalDetails = normalizeText(body.additionalDetails || body.additional_details, 2000);

  return {
    ok: true,
    fields: {
      customerName,
      customerEmail,
      companyName,
      category,
      title,
      description,
      budget: budget || null,
      deadline: deadline || null,
      additionalDetails: additionalDetails || null
    }
  };
}

async function findDuplicateRequest(db, fields) {
  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query(
      `SELECT id FROM customer_requests WHERE customer_email = $1 AND title = $2 AND description = $3 AND created_at >= NOW() - INTERVAL '30 days' LIMIT 1`,
      [fields.customerEmail, fields.title, fields.description]
    );
    return res.rows[0] || null;
  }

  const row = db.prepare(`SELECT id FROM customer_requests WHERE customer_email = ? AND title = ? AND description = ? AND created_at >= datetime('now', '-30 days') LIMIT 1`).get(fields.customerEmail, fields.title, fields.description);
  return row || null;
}

async function createRequest(db, body) {
  const v = validateRequest(body);
  if (!v.ok) return v;

  const existing = await findDuplicateRequest(db, v.fields);
  if (existing) {
    return { ok: false, status: 409, message: 'A similar request has already been submitted recently.' };
  }

  try {
    if (pgConnectionString()) {
      await ensurePgTable();
      const res = await getPool().query(
        `INSERT INTO customer_requests (customer_name, customer_email, company_name, category, title, description, budget, deadline, additional_details, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'NEW') RETURNING *`,
        [v.fields.customerName, v.fields.customerEmail, v.fields.companyName || null, v.fields.category, v.fields.title, v.fields.description, v.fields.budget, v.fields.deadline, v.fields.additionalDetails]
      );
      return { ok: true, ...shapeRequest(res.rows[0]), status: 'NEW' };
    }

    const info = db.prepare(`INSERT INTO customer_requests (customer_name, customer_email, company_name, category, title, description, budget, deadline, additional_details, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')`).run(
      v.fields.customerName,
      v.fields.customerEmail,
      v.fields.companyName || null,
      v.fields.category,
      v.fields.title,
      v.fields.description,
      v.fields.budget,
      v.fields.deadline,
      v.fields.additionalDetails
    );
    const row = db.prepare('SELECT * FROM customer_requests WHERE id = ?').get(info.lastInsertRowid);
    return { ok: true, ...shapeRequest(row), status: 'NEW' };
  } catch (err) {
    console.error('createRequest failed:', err.message);
    return { ok: false, status: 500, message: 'Unable to submit the request right now. Please try again.' };
  }
}

async function listRequests(db, options = {}) {
  const opts = options || {};
  const status = typeof opts.status === 'string' ? opts.status.trim().toUpperCase() : '';
  const search = typeof opts.search === 'string' ? opts.search.trim() : '';
  const sort = opts.sort === 'updated' ? 'updated_at' : 'created_at';
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  if (pgConnectionString()) {
    await ensurePgTable();
    const where = [];
    const params = [];

    if (REQUEST_STATUSES.includes(status)) {
      where.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (search) {
      where.push(`(customer_name ILIKE $${params.length + 1} OR customer_email ILIKE $${params.length + 1} OR company_name ILIKE $${params.length + 1} OR title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const totalRes = await getPool().query(`SELECT COUNT(*)::int AS total FROM customer_requests${whereSql}`, params);
    const rowsRes = await getPool().query(
      `SELECT * FROM customer_requests${whereSql} ORDER BY ${sort} DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return { items: rowsRes.rows.map(shapeRequest), total: totalRes.rows[0].total };
  }

  const conditions = [];
  const params = [];
  if (REQUEST_STATUSES.includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('(customer_name LIKE ? OR customer_email LIKE ? OR company_name LIKE ? OR title LIKE ? OR description LIKE ?)');
    const v = `%${search}%`;
    params.push(v, v, v, v, v);
  }

  const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS total FROM customer_requests${whereSql}`).get(...params).total;
  const rows = db.prepare(`SELECT * FROM customer_requests${whereSql} ORDER BY ${sort} DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { items: rows.map(shapeRequest), total };
}

async function getRequestById(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  if (pgConnectionString()) {
    await ensurePgTable();
    const res = await getPool().query('SELECT * FROM customer_requests WHERE id = $1', [numericId]);
    return res.rows[0] ? shapeRequest(res.rows[0]) : null;
  }

  const row = db.prepare('SELECT * FROM customer_requests WHERE id = ?').get(numericId);
  return row ? shapeRequest(row) : null;
}

async function updateRequestStatus(db, id, nextStatus) {
  const numericId = Number(id);
  const safeStatus = typeof nextStatus === 'string' ? nextStatus.trim().toUpperCase() : '';
  if (!Number.isInteger(numericId) || numericId <= 0 || !REQUEST_STATUSES.includes(safeStatus)) {
    return { ok: false, status: 400, message: 'Invalid status value.' };
  }

  try {
    if (pgConnectionString()) {
      await ensurePgTable();
      const res = await getPool().query(
        `UPDATE customer_requests SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [safeStatus, numericId]
      );
      if (!res.rows[0]) return { ok: false, status: 404, message: 'Request not found.' };
      return { ok: true, ...shapeRequest(res.rows[0]), status: safeStatus };
    }

    const info = db.prepare(`UPDATE customer_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(safeStatus, numericId);
    if (info.changes === 0) return { ok: false, status: 404, message: 'Request not found.' };
    const row = db.prepare('SELECT * FROM customer_requests WHERE id = ?').get(numericId);
    return { ok: true, ...shapeRequest(row), status: safeStatus };
  } catch (err) {
    console.error('updateRequestStatus failed:', err.message);
    return { ok: false, status: 500, message: 'Unable to update request status.' };
  }
}

module.exports = {
  EMAIL_RE,
  REQUEST_STATUSES,
  REQUEST_CATEGORIES,
  DEFAULT_STATUS,
  pgConnectionString,
  createDb: process.env.VERCEL === '1' ? (() => null) : createDb,
  validateRequest,
  createRequest,
  listRequests,
  getRequestById,
  updateRequestStatus
};
