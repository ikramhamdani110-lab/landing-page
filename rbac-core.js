// TALORA — Role-Based Access Control (Task 9)
//
// One reusable authorization layer for BOTH deployment targets, following the same
// pattern as content-core.js / auth-user-core.js:
//   - serve.js  (local Node server)
//   - api/*.js  (Vercel serverless)
//
// Design notes
// ------------
// * Authentication is NOT re-implemented. The principal is derived from the two
//   existing, already-trusted credential systems:
//     1. the admin bearer token (HMAC with ADMIN_TOKEN_SECRET) -> ADMIN
//     2. the user bearer token  (HMAC with USER_TOKEN_SECRET)    -> role from the
//        `users` row in the database, never from the request body.
// * The user's role is ALWAYS read from the server-side user record. The token
//   payload only carries a generic "user" marker; the authoritative role is the
//   database column, so a forged/stale payload can never escalate privileges.
// * HTTP semantics follow the existing convention: 401 when there is no valid
//   session, 403 when there is a valid session but the role lacks the permission.

const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  EMPLOYEE: 'EMPLOYEE'
});

const ROLE_VALUES = Object.freeze(Object.keys(ROLES)); // ['ADMIN', 'EMPLOYEE']

// Legacy value written by earlier releases — mapped to EMPLOYEE on read.
const LEGACY_ROLE_ALIASES = Object.freeze({ user: ROLES.EMPLOYEE });

// Permissions. Named after the real TALORA resources, not invented ones.
const PERMISSIONS = Object.freeze({
  CONTENT_READ: 'content:read',
  CONTENT_CREATE: 'content:create',
  CONTENT_UPDATE: 'content:update',
  CONTENT_DELETE: 'content:delete',
  SERVICES_READ: 'services:read',
  SERVICES_CREATE: 'services:create',
  SERVICES_UPDATE: 'services:update',
  SERVICES_DELETE: 'services:delete',
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage'
});

// Role -> permission matrix. Single source of truth for the whole application.
const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: Object.freeze([
    PERMISSIONS.CONTENT_READ, PERMISSIONS.CONTENT_CREATE, PERMISSIONS.CONTENT_UPDATE, PERMISSIONS.CONTENT_DELETE,
    PERMISSIONS.SERVICES_READ, PERMISSIONS.SERVICES_CREATE, PERMISSIONS.SERVICES_UPDATE, PERMISSIONS.SERVICES_DELETE,
    PERMISSIONS.SETTINGS_READ, PERMISSIONS.SETTINGS_UPDATE,
    PERMISSIONS.USERS_READ, PERMISSIONS.USERS_MANAGE
  ]),
  [ROLES.EMPLOYEE]: Object.freeze([
    // View records and update permitted records/fields only. No create, no delete,
    // no settings, and no user/role management.
    PERMISSIONS.CONTENT_READ, PERMISSIONS.CONTENT_UPDATE
  ])
});

// Normalize any stored/legacy value into a known role. Returns null when unknown.
function normalizeRole(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  if (ROLE_VALUES.includes(v)) return v;
  return LEGACY_ROLE_ALIASES[v.toLowerCase()] || null;
}

// Normalize for STORAGE. Never stores an arbitrary string: an unknown value
// degrades to the least-privileged role instead of being persisted.
function normalizeRoleForStorage(value, fallback = ROLES.EMPLOYEE) {
  return normalizeRole(value) || fallback;
}

function can(role, permission) {
  const r = normalizeRole(role);
  if (!r) return false;
  return ROLE_PERMISSIONS[r].includes(permission);
}

function permissionsFor(role) {
  return (ROLE_PERMISSIONS[normalizeRole(role)] || []).slice();
}

// Resolve the authenticated principal for a request.
// Returns { kind: 'admin' | 'user', role, user? } or null when unauthenticated.
//   - 'admin'  = env-configured CMS admin token (existing content-core verifyAuth)
//   - 'user'   = a registered users-table account, role read from the DB row
async function getPrincipal(req, db) {
  let isAdmin = false;
  try { isAdmin = !!require('./content-core').verifyAuth(req); } catch (_) { isAdmin = false; }
  if (isAdmin) return { kind: 'admin', role: ROLES.ADMIN, user: null };

  let user = null;
  try { user = await require('./auth-user-core').getUserFromRequest(req); } catch (_) { user = null; }
  if (!user) return null;

  // Authoritative role comes from the server-side user record.
  const role = normalizeRole(user.role) || ROLES.EMPLOYEE;
  return { kind: 'user', role, user };
}

// ---------- Express/Node-handler helpers ----------

function sendJson(res, status, obj) {
  if (typeof res.status === 'function') {
    res.status(status);
    if (typeof res.json === 'function') return res.json(obj);
  }
  res.statusCode = status;
  if (!res.headersSent && typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  return res.end(JSON.stringify(obj));
}

// Message shape matches the existing project: { error } for the auth/user API,
// { success:false, message } for the CMS API. `style` picks between them.
const STYLES = {
  cms: (message) => ({ success: false, message }),
  api: (message) => ({ error: message })
};

function unauthorized(res, style = 'api') {
  return sendJson(res, 401, STYLES[style] || STYLES.api('Unauthorized.'));
}

function forbidden(res, style = 'api') {
  return sendJson(res, 403, STYLES[style] || STYLES.api('You do not have permission to perform this action.'));
}

// requireAuth(req, res, { db, style })
//   -> principal object, or null after having already written 401/403 to res.
async function requireAuth(req, res, { db, style } = {}) {
  const principal = await getPrincipal(req, db);
  if (!principal) { unauthorized(res, style); return null; }
  return principal;
}

// requirePermission(req, res, permission, { db, style })
//   -> principal object when the role holds the permission, else null (401/403 sent).
async function requirePermission(req, res, permission, { db, style } = {}) {
  const principal = await requireAuth(req, res, { db, style });
  if (!principal) return null;
  if (!can(principal.role, permission)) { forbidden(res, style); return null; }
  return principal;
}

// requireRole(req, res, 'ADMIN', { db, style })
//   -> principal when the authenticated principal's role matches, else null (401/403 sent).
async function requireRole(req, res, role, { db, style } = {}) {
  const principal = await requireAuth(req, res, { db, style });
  if (!principal) return null;
  if (principal.role !== normalizeRole(role)) { forbidden(res, style); return null; }
  return principal;
}

// A field-level guard for the "EMPLOYEE may only update permitted fields" rule.
// Fields not listed are dropped (never an error) so the employee UI can still
// post the whole form payload. The caller must merge the result with the stored
// record so the omitted columns keep their current values.
const EMPLOYEE_CONTENT_FIELDS = Object.freeze(['title', 'description', 'category', 'section']);

function restrictContentFields(fields, role) {
  if (normalizeRole(role) === ROLES.ADMIN) return Object.assign({}, fields);
  const out = {};
  for (const k of EMPLOYEE_CONTENT_FIELDS) if (fields[k] !== undefined) out[k] = fields[k];
  return out;
}

// Build a full, valid field set for content-core.updateContent(): an EMPLOYEE's
// permitted fields from the request, every other column carried over from the
// stored record so a partial payload can never blank out or escalate a column.
function mergeContentFields(existing, submitted, role) {
  const base = existing || {};
  const permitted = restrictContentFields(submitted, role);
  return {
    title: permitted.title !== undefined ? permitted.title : base.title,
    description: permitted.description !== undefined ? permitted.description : base.description,
    category: permitted.category !== undefined ? permitted.category : base.category,
    section: permitted.section !== undefined ? permitted.section : base.section,
    // status is ADMIN-only: never taken from a non-admin's request.
    status: normalizeRole(role) === ROLES.ADMIN && submitted.status !== undefined ? submitted.status : base.status
  };
}

module.exports = {
  ROLES, ROLE_VALUES, PERMISSIONS, ROLE_PERMISSIONS, EMPLOYEE_CONTENT_FIELDS,
  normalizeRole, normalizeRoleForStorage, can, permissionsFor,
  getPrincipal, requireAuth, requireRole, requirePermission,
  unauthorized, forbidden, sendJson, restrictContentFields, mergeContentFields
};
