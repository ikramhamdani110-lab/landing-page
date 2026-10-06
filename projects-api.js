// Task 11 — shared handlers for the client & project management endpoints.
// Used by both serve.js (local Node server) and api/[...path].js (Vercel serverless).
// Every DB/storage touch goes through projects-core.js.
//
// Authorization uses the EXISTING Task 9 RBAC layer (rbac-core) — same roles,
// same permission matrix, no new mechanism:
//   ADMIN    (projects:create/update:any/delete/assign, clients:manage) — full control
//   EMPLOYEE (team member; projects:read, clients:read)                 — reads assigned
//           projects and may update the STATUS of a project they are assigned to.
//
// Endpoints:
//   GET    /api/clients              (both roles)
//   POST   /api/clients              (ADMIN)
//   GET    /api/clients/:id          (both roles)
//   PATCH  /api/clients/:id          (ADMIN)
//   DELETE /api/clients/:id          (ADMIN)
//   GET    /api/projects             (both roles; team member sees assigned only)
//   POST   /api/projects             (ADMIN)
//   GET    /api/projects/:id         (both roles; team member must be assigned)
//   PATCH  /api/projects/:id         (ADMIN: all fields; EMPLOYEE: status of own project)
//   DELETE /api/projects/:id         (ADMIN)
//   GET    /api/projects/users       (ADMIN: assignable team members)

const rbac = require('./rbac-core');
const pc = require('./projects-core');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function openDb() {
  if (pc.pgConnectionString()) return null;
  return pc.createDb(process.env.DATABASE_PATH || 'talora.db');
}
async function withDb(fn) {
  const db = openDb();
  try { return await fn(db); }
  finally { if (db && db.close) db.close(); }
}

// Resolve principal via RBAC; sends the 401/403 response and returns null on failure.
async function requirePermission(req, res, permission) {
  const principal = await rbac.getPrincipal(req, null);
  if (!principal) {
    json(res, 401, { success: false, error: 'You must be signed in to perform this action.' });
    return null;
  }
  if (permission && !rbac.can(principal.role, permission)) {
    json(res, 403, { success: false, error: 'You are not authorized to perform this action.' });
    return null;
  }
  const userId = principal.kind === 'user' && principal.user ? principal.user.id : null;
  return { kind: principal.kind, role: principal.role, userId };
}

async function readBody(req, limit = 200000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- Clients ----------
async function clientsCollection(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const principal = await requirePermission(req, res, rbac.PERMISSIONS.CLIENTS_READ);
    if (!principal) return;
    const items = await withDb((db) => pc.listClients(db));
    return json(res, 200, { success: true, items });
  }
  if (method === 'POST') {
    const principal = await requirePermission(req, res, rbac.PERMISSIONS.CLIENTS_MANAGE);
    if (!principal) return;
    const body = await readBody(req);
    const validation = pc.validateClient(body);
    if (!validation.ok) return json(res, validation.status, { success: false, error: validation.message, field: validation.field });
    const client = await withDb((db) => pc.createClient(db, validation.fields));
    return json(res, 201, { success: true, message: 'Client created successfully.', client });
  }
  res.setHeader('Allow', 'GET, POST');
  return json(res, 405, { success: false, error: 'Method not allowed.' });
}

async function clientItem(req, res, id) {
  const method = (req.method || 'GET').toUpperCase();
  const principal = await requirePermission(req, res, method === 'GET' ? rbac.PERMISSIONS.CLIENTS_READ : rbac.PERMISSIONS.CLIENTS_MANAGE);
  if (!principal) return;
  if (method === 'GET') {
    const client = await withDb((db) => pc.getClient(db, id));
    if (!client) return json(res, 404, { success: false, error: 'Client not found.' });
    const projects = await withDb((db) => pc.listProjects(db, principal, { clientId: client.id }));
    return json(res, 200, { success: true, client, projects: projects.items });
  }
  if (method === 'PATCH' || method === 'PUT') {
    const body = await readBody(req);
    const validation = pc.validateClient(body);
    if (!validation.ok) return json(res, validation.status, { success: false, error: validation.message, field: validation.field });
    const client = await withDb((db) => pc.updateClient(db, id, validation.fields));
    if (!client) return json(res, 404, { success: false, error: 'Client not found.' });
    return json(res, 200, { success: true, message: 'Client updated successfully.', client });
  }
  if (method === 'DELETE') {
    const result = await withDb((db) => pc.deleteClient(db, id));
    if (result.status === 404) return json(res, 404, { success: false, error: 'Client not found.' });
    if (!result.ok) return json(res, result.status || 409, { success: false, error: result.message || 'Unable to delete client.' });
    return json(res, 200, { success: true, message: 'Client deleted successfully.' });
  }
  res.setHeader('Allow', 'GET, PATCH, PUT, DELETE');
  return json(res, 405, { success: false, error: 'Method not allowed.' });
}

// ---------- Projects ----------
// ADMIN -> every project; team member -> assigned projects only (SQL-level filter).
async function projectsCollection(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const principal = await requirePermission(req, res, rbac.PERMISSIONS.PROJECTS_READ);
    if (!principal) return;
    const q = new URL(req.url || '/', 'http://localhost').searchParams;
    const data = await withDb((db) => pc.listProjects(db, principal, {
      status: q.get('status'),
      clientId: q.get('clientId'),
      search: q.get('search')
    }));
    const stats = computeStats(data.items);
    return json(res, 200, { success: true, items: data.items, total: data.total, stats });
  }
  if (method === 'POST') {
    const principal = await requirePermission(req, res, rbac.PERMISSIONS.PROJECTS_CREATE);
    if (!principal) return;
    const body = await readBody(req);
    const validation = pc.validateProject(body);
    if (!validation.ok) return json(res, validation.status, { success: false, error: validation.message, field: validation.field });
    const fields = validation.fields;

    // Verify the client exists (no arbitrary client ids).
    const client = await withDb((db) => pc.getClient(db, fields.clientId));
    if (!client) return json(res, 400, { success: false, error: 'The selected client does not exist.', field: 'clientId' });

    // Verify every assigned user exists and is an EMPLOYEE (team member).
    if (fields.teamMemberIds.length) {
      const bad = await verifyTeamMembers(fields.teamMemberIds);
      if (bad) return json(res, bad.status, { success: false, error: bad.message, field: 'teamMemberIds' });
    }

    const id = await withDb(async (db) => {
      const pid = await pc.insertProject(db, fields, principal.userId);
      if (fields.teamMemberIds.length) await pc.replaceProjectTeam(db, pid, fields.teamMemberIds);
      return pid;
    });
    const project = await withDb((db) => pc.getProject(db, id));
    return json(res, 201, { success: true, message: 'Project created successfully.', project });
  }
  res.setHeader('Allow', 'GET, POST');
  return json(res, 405, { success: false, error: 'Method not allowed.' });
}

async function verifyTeamMembers(ids) {
  for (const uid of ids) {
    const user = await withDb((db) => pc.userExists(db, uid));
    if (!user) return { status: 400, message: `Team member ${uid} does not exist.` };
    const role = rbac.normalizeRole(user.role) || rbac.ROLES.EMPLOYEE;
    if (role === rbac.ROLES.ADMIN) {
      return { status: 400, message: 'Admin accounts cannot be assigned as project team members.' };
    }
  }
  return null;
}

// Live dashboard statistics from the real data set (no fake numbers).
function computeStats(items) {
  const total = items.length;
  const active = items.filter((p) => p.status === 'IN_PROGRESS').length;
  const completed = items.filter((p) => p.status === 'COMPLETED').length;
  const notStarted = items.filter((p) => p.status === 'NOT_STARTED').length;
  const onHold = items.filter((p) => p.status === 'ON_HOLD').length;
  return { total, active, completed, notStarted, onHold };
}

async function projectItem(req, res, id) {
  const method = (req.method || 'GET').toUpperCase();
  // Preflight: identity first (401 before 403/404), then role.
  const principal = await rbac.getPrincipal(req, null);
  if (!principal) return json(res, 401, { success: false, error: 'You must be signed in to perform this action.' });
  const isAdmin = principal.kind === 'admin' || principal.role === rbac.ROLES.ADMIN;
  const userId = principal.kind === 'user' && principal.user ? principal.user.id : null;

  if (method === 'GET') {
    if (!rbac.can(principal.role, rbac.PERMISSIONS.PROJECTS_READ)) {
      return json(res, 403, { success: false, error: 'You are not authorized to perform this action.' });
    }
    const project = await withDb((db) => pc.getProject(db, id));
    if (!project) return json(res, 404, { success: false, error: 'Project not found.' });
    if (!isAdmin) {
      const assigned = await withDb((db) => pc.isAssigned(db, project.id, userId));
      if (!assigned) return json(res, 403, { success: false, error: 'You are not authorized to view this project.' });
    }
    const team = await withDb((db) => pc.getProjectTeam(db, project.id));
    return json(res, 200, { success: true, project: { ...project, team } });
  }

  if (method === 'PATCH' || method === 'PUT') {
    const project = await withDb((db) => pc.getProject(db, id));
    if (!project) return json(res, 404, { success: false, error: 'Project not found.' });

    if (isAdmin) {
      // ADMIN: any field (name, description, clientId, status, teamMemberIds).
      if (!rbac.can(principal.role, rbac.PERMISSIONS.PROJECTS_UPDATE_ANY)) {
        return json(res, 403, { success: false, error: 'You are not authorized to perform this action.' });
      }
      const body = await readBody(req);
      const validation = pc.validateProject(body);
      if (!validation.ok) return json(res, validation.status, { success: false, error: validation.message, field: validation.field });
      const fields = validation.fields;
      const client = await withDb((db) => pc.getClient(db, fields.clientId));
      if (!client) return json(res, 400, { success: false, error: 'The selected client does not exist.', field: 'clientId' });
      if (fields.teamMemberIds.length) {
        const bad = await verifyTeamMembers(fields.teamMemberIds);
        if (bad) return json(res, bad.status, { success: false, error: bad.message, field: 'teamMemberIds' });
      }
      await withDb(async (db) => {
        await pc.updateProjectRow(db, project.id, fields);
        await pc.replaceProjectTeam(db, project.id, fields.teamMemberIds);
      });
      const updated = await withDb((db) => pc.getProject(db, project.id));
      const team = await withDb((db) => pc.getProjectTeam(db, project.id));
      return json(res, 200, { success: true, message: 'Project updated successfully.', project: { ...updated, team } });
    }

    // TEAM MEMBER: may update ONLY the status of a project they are assigned to.
    const assigned = await withDb((db) => pc.isAssigned(db, project.id, userId));
    if (!assigned) return json(res, 403, { success: false, error: 'You are not authorized to update this project.' });
    const body = await readBody(req);
    const data = typeof body === 'string' ? (JSON.parse(body || '{}')) : (body || {});
    // Reject any attempt to touch non-status fields through the team-member path.
    const forbidden = Object.keys(data).filter((k) => k !== 'status');
    if (forbidden.length) {
      return json(res, 403, { success: false, error: 'Team members can only update the project status.' });
    }
    const statusValidation = pc.validateStatus(data.status);
    if (!statusValidation.ok) return json(res, statusValidation.status, { success: false, error: statusValidation.message });
    await withDb((db) => pc.updateProjectRow(db, project.id, { status: statusValidation.status }));
    const updated = await withDb((db) => pc.getProject(db, project.id));
    return json(res, 200, { success: true, message: 'Project status updated.', project: updated });
  }

  if (method === 'DELETE') {
    if (!rbac.can(principal.role, rbac.PERMISSIONS.PROJECTS_DELETE)) {
      return json(res, 403, { success: false, error: 'You are not authorized to delete projects.' });
    }
    const ok = await withDb((db) => pc.deleteProject(db, id));
    if (!ok) return json(res, 404, { success: false, error: 'Project not found.' });
    return json(res, 200, { success: true, message: 'Project deleted successfully.' });
  }

  res.setHeader('Allow', 'GET, PATCH, PUT, DELETE');
  return json(res, 405, { success: false, error: 'Method not allowed.' });
}

// GET /api/projects/users — assignable team members (ADMIN only).
async function teamMembers(req, res) {
  const principal = await requirePermission(req, res, rbac.PERMISSIONS.USERS_READ);
  if (!principal) return;
  const users = await withDb((db) => require('./auth-user-core').listUsers(db, {}));
  const assignable = users
    .filter((u) => (rbac.normalizeRole(u.role) || rbac.ROLES.EMPLOYEE) === rbac.ROLES.EMPLOYEE)
    .map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, role: rbac.ROLES.EMPLOYEE }));
  return json(res, 200, { success: true, users: assignable });
}

module.exports = { clientsCollection, clientItem, projectsCollection, projectItem, teamMembers };
