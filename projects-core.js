// Task 11 — Client Project Management Platform (shared core logic).
// Same dual-backend pattern as documents-core.js / requests-core.js:
//   - serve.js (local Node server, SQLite via better-sqlite3)
//   - api/[...path].js (Vercel serverless, PostgreSQL via DATABASE_URL / POSTGRES_URL)
//
// Entities:
//   clients(id, name, description, contact_email, created_at, updated_at)
//   projects(id, name, description, status, client_id -> clients.id, created_by, created_at, updated_at)
//   project_team_members(project_id -> projects.id, user_id -> users.id, added_at)
//
// Relationships (FKs, no orphan records):
//   Client 1--N Project  N--M User (via project_team_members)
//
// Authorization is enforced by the CALLER through the existing Task 9 RBAC layer
// (rbac-core). This module owns validation + data only; every handler checks
// permissions before touching it, so UI bypass cannot reach the database.

// ---------- Statuses (Task 11 spec; DB CHECK constraints mirror this list) ----------
const PROJECT_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'];
const STATUS_LABELS = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold'
};

// ---------- Database (dual backend) ----------
function pgConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function createDb(dbFile) {
  const Database = require('better-sqlite3');
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    contact_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','ON_HOLD')),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS project_team_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, user_id)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ptm_user ON project_team_members(user_id)`);
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

async function ensurePgTables() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    contact_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await getPool().query(`CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED',
    client_id INTEGER NOT NULL REFERENCES clients(id),
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await getPool().query(`CREATE TABLE IF NOT EXISTS project_team_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
  )`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id)`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_ptm_user ON project_team_members(user_id)`);
}

function iso(v) {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : new Date(v).toISOString();
}

function shapeClient(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description || null,
    contactEmail: r.contact_email || null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

function shapeProject(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description || null,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] || r.status,
    clientId: r.client_id,
    clientName: r.client_name || null,
    createdBy: r.created_by || null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    teamNames: r.team_names ? r.team_names.split(', ').filter(Boolean) : []
  };
}

// ---------- Validation ----------
function vText(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}
function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}
function parseBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body || '{}'); } catch { return null; }
  }
  return null;
}

// Returns { ok, fields } or { ok: false, status, message, field }
function validateClient(body) {
  const data = parseBody(body);
  if (!data) return { ok: false, status: 400, message: 'Invalid request body.' };
  const name = vText(data.name, 120);
  if (!name) return { ok: false, status: 400, message: 'Client name is required.', field: 'name' };
  if (name.length < 2) return { ok: false, status: 400, message: 'Client name must be at least 2 characters.', field: 'name' };
  const description = vText(data.description, 2000) || null;
  const contactEmail = vText(data.contactEmail || data.contact_email, 200) || null;
  if (contactEmail && !validEmail(contactEmail)) {
    return { ok: false, status: 400, message: 'Please provide a valid contact email.', field: 'contactEmail' };
  }
  return { ok: true, fields: { name, description, contactEmail } };
}

// Returns { ok, fields: {name, description, clientId, status, teamMemberIds} }
function validateProject(body) {
  const data = parseBody(body);
  if (!data) return { ok: false, status: 400, message: 'Invalid request body.' };
  const name = vText(data.name, 150);
  if (!name) return { ok: false, status: 400, message: 'Project name is required.', field: 'name' };
  if (name.length < 3) return { ok: false, status: 400, message: 'Project name must be at least 3 characters.', field: 'name' };
  const description = vText(data.description, 5000) || null;
  const clientId = Number(data.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, status: 400, message: 'Please select a valid client.', field: 'clientId' };
  }
  const status = vText(data.status, 30).toUpperCase() || 'NOT_STARTED';
  if (!PROJECT_STATUSES.includes(status)) {
    return { ok: false, status: 400, message: 'Invalid status. Allowed: ' + PROJECT_STATUSES.join(', '), field: 'status' };
  }
  let teamMemberIds = [];
  if (data.teamMemberIds !== undefined && data.teamMemberIds !== null) {
    if (!Array.isArray(data.teamMemberIds)) {
      return { ok: false, status: 400, message: 'teamMemberIds must be an array of user ids.', field: 'teamMemberIds' };
    }
    teamMemberIds = data.teamMemberIds.map(Number);
    if (teamMemberIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return { ok: false, status: 400, message: 'teamMemberIds must contain valid user ids.', field: 'teamMemberIds' };
    }
  }
  return { ok: true, fields: { name, description, clientId, status, teamMemberIds } };
}

// Validate a standalone status update (PATCH status).
function validateStatus(status) {
  const safe = vText(status, 30).toUpperCase();
  if (!PROJECT_STATUSES.includes(safe)) {
    return { ok: false, status: 400, message: 'Invalid status. Allowed: ' + PROJECT_STATUSES.join(', ') };
  }
  return { ok: true, status: safe };
}

// ---------- Users (team member verification) ----------
function userExists(db, id) {
  if (pgConnectionString()) {
    return getPool().query('SELECT id, role FROM users WHERE id = $1', [id]).then((r) => r.rows[0] || null);
  }
  return db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) || null;
}

// ---------- Clients ----------
async function listClients(db) {
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query('SELECT * FROM clients ORDER BY name ASC');
    return res.rows.map(shapeClient);
  }
  return db.prepare('SELECT * FROM clients ORDER BY name ASC').all().map(shapeClient);
}

async function getClient(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query('SELECT * FROM clients WHERE id = $1', [numericId]);
    return res.rows[0] ? shapeClient(res.rows[0]) : null;
  }
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(numericId);
  return row ? shapeClient(row) : null;
}

async function createClient(db, fields) {
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query(
      'INSERT INTO clients (name, description, contact_email) VALUES ($1, $2, $3) RETURNING *',
      [fields.name, fields.description, fields.contactEmail]
    );
    return shapeClient(res.rows[0]);
  }
  const info = db.prepare('INSERT INTO clients (name, description, contact_email) VALUES (?, ?, ?)')
    .run(fields.name, fields.description, fields.contactEmail);
  return shapeClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
}

async function updateClient(db, id, fields) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query(
      `UPDATE clients SET name = COALESCE($1, name), description = COALESCE($2, description),
       contact_email = COALESCE($3, contact_email), updated_at = now() WHERE id = $4 RETURNING *`,
      [fields.name || null, fields.description, fields.contactEmail, numericId]
    );
    return res.rows[0] ? shapeClient(res.rows[0]) : null;
  }
  const info = db.prepare(
    `UPDATE clients SET name = COALESCE(?, name), description = COALESCE(?, description),
     contact_email = COALESCE(?, contact_email), updated_at = datetime('now') WHERE id = ?`
  ).run(fields.name || null, fields.description, fields.contactEmail, numericId);
  if (info.changes === 0) return null;
  return shapeClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(numericId));
}

// Deletes a client. Refuses when projects still reference it (409) so no project
// is ever orphaned; the caller surfaces a clear message.
async function deleteClient(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return { ok: false, status: 404 };
  const count = pgConnectionString()
    ? (await getPool().query('SELECT COUNT(*)::int AS c FROM projects WHERE client_id = $1', [numericId])).rows[0].c
    : db.prepare('SELECT COUNT(*) AS c FROM projects WHERE client_id = ?').get(numericId).c;
  if (count > 0) {
    return { ok: false, status: 409, message: `This client has ${count} project(s). Delete or reassign them first.` };
  }
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query('DELETE FROM clients WHERE id = $1 RETURNING id', [numericId]);
    if (!res.rows[0]) return { ok: false, status: 404 };
    return { ok: true };
  }
  const info = db.prepare('DELETE FROM clients WHERE id = ?').run(numericId);
  if (info.changes === 0) return { ok: false, status: 404 };
  return { ok: true };
}

// ---------- Projects ----------
const SELECT_COLS = `
  SELECT p.*, c.name AS client_name,
    (SELECT GROUP_CONCAT(u.full_name, ', ')
       FROM project_team_members ptm JOIN users u ON u.id = ptm.user_id
      WHERE ptm.project_id = p.id) AS team_names
  FROM projects p JOIN clients c ON c.id = p.client_id`;
const PG_SELECT_COLS = `
  SELECT p.*, c.name AS client_name,
    COALESCE((SELECT string_agg(u.full_name, ', ')
       FROM project_team_members ptm JOIN users u ON u.id = ptm.user_id
      WHERE ptm.project_id = p.id), '') AS team_names
  FROM projects p JOIN clients c ON c.id = p.client_id`;

// Access rules (Task 11 §10): ADMIN sees every project; a team member (EMPLOYEE)
// only sees projects they are assigned to.
function accessFilter(principal) {
  if (!principal) return null;
  if (principal.kind === 'admin' || principal.role === 'ADMIN') return null;
  return principal.userId;
}

async function listProjects(db, principal, options = {}) {
  const opts = options || {};
  const conditions = [];
  const params = [];

  const assignedTo = accessFilter(principal);
  if (assignedTo !== null) {
    conditions.push('p.id IN (SELECT project_id FROM project_team_members WHERE user_id = ?)');
    params.push(assignedTo);
  }
  if (opts.clientId !== undefined && opts.clientId !== null && opts.clientId !== '') {
    const cid = Number(opts.clientId);
    if (Number.isInteger(cid) && cid > 0) { conditions.push('p.client_id = ?'); params.push(cid); }
  }
  const status = typeof opts.status === 'string' ? opts.status.trim().toUpperCase() : '';
  if (PROJECT_STATUSES.includes(status)) { conditions.push('p.status = ?'); params.push(status); }
  const search = typeof opts.search === 'string' ? opts.search.trim() : '';
  if (search) {
    conditions.push('(p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
    const v = `%${search}%`;
    params.push(v, v, v);
  }

  const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  if (pgConnectionString()) {
    await ensurePgTables();
    // Rebuild conditions with $n placeholders for Postgres.
    const pgConditions = [];
    const pgParams = [];
    let n = 0;
    const pushPg = (clause, value) => { pgConditions.push(clause.replace('?', `$${++n}`)); pgParams.push(value); };
    if (assignedTo !== null) pushPg('p.id IN (SELECT project_id FROM project_team_members WHERE user_id = ?)', assignedTo);
    if (opts.clientId !== undefined && opts.clientId !== null && opts.clientId !== '') {
      const cid = Number(opts.clientId);
      if (Number.isInteger(cid) && cid > 0) pushPg('p.client_id = ?', cid);
    }
    if (PROJECT_STATUSES.includes(status)) pushPg('p.status = ?', status);
    if (search) {
      pgConditions.push(`(p.name ILIKE $${++n} OR p.description ILIKE $${n} OR c.name ILIKE $${n})`);
      pgParams.push(`%${search}%`);
    }
    const pgWhere = pgConditions.length ? ' WHERE ' + pgConditions.join(' AND ') : '';
    const totalRes = await getPool().query(`SELECT COUNT(*)::int AS total FROM projects p JOIN clients c ON c.id = p.client_id${pgWhere}`, pgParams);
    const rowsRes = await getPool().query(`${PG_SELECT_COLS}${pgWhere} ORDER BY p.created_at DESC, p.id DESC`, pgParams);
    return { items: rowsRes.rows.map(shapeProject), total: totalRes.rows[0].total };
  }

  const total = db.prepare(`SELECT COUNT(*) AS total FROM projects p JOIN clients c ON c.id = p.client_id${whereSql}`).get(...params).total;
  const rows = db.prepare(`${SELECT_COLS}${whereSql} ORDER BY p.created_at DESC, p.id DESC`).all(...params);
  return { items: rows.map(shapeProject), total };
}

async function getProject(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query(`${PG_SELECT_COLS} WHERE p.id = $1`, [numericId]);
    return res.rows[0] ? shapeProject(res.rows[0]) : null;
  }
  const row = db.prepare(`${SELECT_COLS} WHERE p.id = ?`).get(numericId);
  return row ? shapeProject(row) : null;
}

async function insertProject(db, fields, createdBy) {
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query(
      `INSERT INTO projects (name, description, status, client_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [fields.name, fields.description, fields.status, fields.clientId, createdBy || null]
    );
    return res.rows[0].id;
  }
  const info = db.prepare(
    `INSERT INTO projects (name, description, status, client_id, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(fields.name, fields.description, fields.status, fields.clientId, createdBy || null);
  return info.lastInsertRowid;
}

async function updateProjectRow(db, id, fields) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query(
      `UPDATE projects SET name = COALESCE($1, name), description = COALESCE($2, description),
       status = COALESCE($3, status), client_id = COALESCE($4, client_id), updated_at = now()
       WHERE id = $5 RETURNING id`,
      [fields.name || null, fields.description, fields.status || null, fields.clientId || null, numericId]
    );
    return !!res.rows[0];
  }
  const info = db.prepare(
    `UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description),
     status = COALESCE(?, status), client_id = COALESCE(?, client_id), updated_at = datetime('now')
     WHERE id = ?`
  ).run(fields.name || null, fields.description, fields.status || null, fields.clientId || null, numericId);
  return info.changes > 0;
}

async function deleteProject(db, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return false;
  if (pgConnectionString()) {
    await ensurePgTables();
    const res = await getPool().query('DELETE FROM projects WHERE id = $1 RETURNING id', [numericId]);
    return !!res.rows[0];
  }
  // team members rows are removed in the same transaction (FK ON DELETE CASCADE also covers it)
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_team_members WHERE project_id = ?').run(numericId);
    return db.prepare('DELETE FROM projects WHERE id = ?').run(numericId).changes;
  });
  return tx() > 0;
}

// ---------- Assignments ----------
async function getProjectTeam(db, projectId) {
  if (pgConnectionString()) {
    const res = await getPool().query(
      'SELECT u.id, u.full_name, u.email FROM project_team_members ptm JOIN users u ON u.id = ptm.user_id WHERE ptm.project_id = $1 ORDER BY u.full_name',
      [projectId]
    );
    return res.rows.map((r) => ({ id: r.id, fullName: r.full_name, email: r.email }));
  }
  return db.prepare(
    'SELECT u.id, u.full_name, u.email FROM project_team_members ptm JOIN users u ON u.id = ptm.user_id WHERE ptm.project_id = ? ORDER BY u.full_name'
  ).all(projectId).map((r) => ({ id: r.id, fullName: r.full_name, email: r.email }));
}

async function replaceProjectTeam(db, projectId, userIds) {
  if (pgConnectionString()) {
    await getPool().query('DELETE FROM project_team_members WHERE project_id = $1', [projectId]);
    for (const uid of userIds) {
      await getPool().query('INSERT INTO project_team_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [projectId, uid]);
    }
    return;
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_team_members WHERE project_id = ?').run(projectId);
    const ins = db.prepare('INSERT OR IGNORE INTO project_team_members (project_id, user_id) VALUES (?, ?)');
    for (const uid of userIds) ins.run(projectId, uid);
  });
  tx();
}

// Is the user assigned to this project? (team-member access checks)
async function isAssigned(db, projectId, userId) {
  if (pgConnectionString()) {
    const res = await getPool().query('SELECT 1 FROM project_team_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    return res.rows.length > 0;
  }
  return !!db.prepare('SELECT 1 FROM project_team_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
}

module.exports = {
  PROJECT_STATUSES, STATUS_LABELS,
  pgConnectionString, createDb, ensurePgTables,
  shapeClient, shapeProject,
  validateClient, validateProject, validateStatus,
  userExists, listClients, getClient, createClient, updateClient, deleteClient,
  listProjects, getProject, insertProject, updateProjectRow, deleteProject,
  getProjectTeam, replaceProjectTeam, isAssigned
};
