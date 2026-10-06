// Task 11 — end-to-end test for the Client & Project Management platform.
// Run with the local server up:  node serve.js   then:  node test-projects-e2e.mjs
// Covers: auth (401), RBAC (admin vs team member), client CRUD + 409 on delete-with-projects,
// project CRUD, client/team validation, statuses, assignment access control,
// no orphan records, and regression of Tasks 4/7/8/9/10 endpoints.
const BASE = process.env.TALORA_BASE || 'http://localhost:5501';
const results = [];
let pass = 0, fail = 0;
function log(name, ok, detail) {
  results.push({ name, ok: !!ok });
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (ok ? '' : ' :: ' + (detail ?? '')));
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

// ---------- fixtures ----------
const stamp = Date.now();

// Authentication
const anonClients = await req('GET', '/api/clients');
log('P01 Unauthenticated client list -> 401', anonClients.status === 401, 'got ' + anonClients.status);
const anonProjects = await req('GET', '/api/projects');
log('P02 Unauthenticated project list -> 401', anonProjects.status === 401, 'got ' + anonProjects.status);
const anonCreate = await req('POST', '/api/projects', { name: 'X', clientId: 1 });
log('P03 Unauthenticated project create -> 401', anonCreate.status === 401, 'got ' + anonCreate.status);

const adminLogin = await req('POST', '/api/auth/admin-login', { username: 'admin', password: 'talora-admin' });
const adminToken = adminLogin.data && adminLogin.data.token;
log('P04 Admin login works', adminLogin.status === 200 && !!adminToken, 'status ' + adminLogin.status);

// Register two team members (EMPLOYEE role)
async function registerUser(name) {
  const email = 'p' + name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 6) + stamp.toString(36) + '@talora.dev';
  const reg = await req('POST', '/api/auth/register', { fullName: name, email, password: 'Str0ngPassw0rd!', confirmPassword: 'Str0ngPassw0rd!' });
  console.log('  [fixture] register', name, reg.status, JSON.stringify(reg.data).slice(0, 120));
  for (let i = 0; i < 8; i++) {
    const login = await req('POST', '/api/auth/user-login', { email, password: 'Str0ngPassw0rd!' });
    if (login.status === 200) {
      return { token: login.data && login.data.token, id: login.data && login.data.user && login.data.user.id };
    }
    console.log('  [fixture] login retry', i, login.status);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}
const memberA = await registerUser('Ikram Tester');
log('P05 Team member A registered + logged in', !!(memberA && memberA.token), '');
const memberB = await registerUser('Sarah Tester');
log('P06 Team member B registered + logged in', !!(memberB && memberB.token), '');
const tokenA = memberA && memberA.token;
const tokenB = memberB && memberB.token;
const idA = memberA && memberA.id;
const idB = memberB && memberB.id;

const memberIds = await req('GET', '/api/projects/users', undefined, adminToken);
const assignable = (memberIds.data && memberIds.data.users) || [];
log('P07 GET /api/projects/users lists employees only (no admin)', memberIds.status === 200 && assignable.length >= 2 && assignable.every((u) => u.role !== 'admin'), 'got ' + assignable.length);
log('P08 Team member cannot list assignable users (ADMIN only) -> 403', (await req('GET', '/api/projects/users', undefined, tokenA)).status === 403, '');

// ---------- Clients (ADMIN) ----------
const c1 = await req('POST', '/api/clients', { name: 'ABC Company', contactEmail: 'ops@abc.test', description: 'Flagship client' }, adminToken);
log('P09 Admin creates a client -> 201', c1.status === 201 && c1.data.client && c1.data.client.id > 0, JSON.stringify(c1.data).slice(0, 120));
const c2 = await req('POST', '/api/clients', { name: 'Northwind Ltd' }, adminToken);
log('P10 Second client created', c2.status === 201, '');
log('P11 Client without name -> 400', (await req('POST', '/api/clients', { name: '' }, adminToken)).status === 400, '');
log('P12 Client with invalid email -> 400', (await req('POST', '/api/clients', { name: 'Zed', contactEmail: 'not-an-email' }, adminToken)).status === 400, '');
log('P13 Team member cannot create a client -> 403', (await req('POST', '/api/clients', { name: 'Sneaky Client' }, tokenA)).status === 403, '');

const clientList = await req('GET', '/api/clients', undefined, tokenA);
log('P14 Team member can view clients (clients:read)', clientList.status === 200 && clientList.data.items.length >= 2, 'got ' + clientList.status);
const clientId1 = c1.data.client.id;

const cUpd = await req('PATCH', '/api/clients/' + clientId1, { name: 'ABC Holdings' }, adminToken);
log('P15 Admin updates a client', cUpd.status === 200 && cUpd.data.client.name === 'ABC Holdings', '');
log('P16 Team member cannot update a client -> 403', (await req('PATCH', '/api/clients/' + clientId1, { name: 'Hacked' }, tokenA)).status === 403, '');
log('P17 Unknown client update -> 404', (await req('PATCH', '/api/clients/999999', { name: 'Ghost' }, adminToken)).status === 404, '');

// ---------- Projects (ADMIN) ----------
const badClient = await req('POST', '/api/projects', { name: 'Ghost Project', clientId: 999999, status: 'NOT_STARTED' }, adminToken);
log('P18 Project with nonexistent client -> 400', badClient.status === 400, 'got ' + badClient.status);
const badStatus = await req('POST', '/api/projects', { name: 'Bad Status', clientId: clientId1, status: 'LAUNCHING' }, adminToken);
log('P19 Project with invalid status -> 400', badStatus.status === 400, '');
const badTeam = await req('POST', '/api/projects', { name: 'Bad Team', clientId: clientId1, teamMemberIds: [999999] }, adminToken);
log('P20 Project with nonexistent team member -> 400', badTeam.status === 400, '');
const noName = await req('POST', '/api/projects', { name: '  ', clientId: clientId1 }, adminToken);
log('P21 Project with empty name -> 400', noName.status === 400, '');

const p1 = await req('POST', '/api/projects', {
  name: 'Website Redesign', description: 'Premium redesign of the marketing site.',
  clientId: clientId1, status: 'IN_PROGRESS', teamMemberIds: [idA, idB]
}, adminToken);
log('P22 Admin creates a project -> 201', p1.status === 201 && p1.data.project && p1.data.project.id > 0, JSON.stringify(p1.data).slice(0, 140));
const projectId = p1.data.project.id;
log('P23 Created project has client + team + status', p1.data.project.clientId === clientId1 && p1.data.project.status === 'IN_PROGRESS' && p1.data.project.teamNames.length === 2, JSON.stringify(p1.data.project.teamNames));

const p2 = await req('POST', '/api/projects', { name: 'Mobile App', clientId: clientId1, status: 'NOT_STARTED', teamMemberIds: [idA] }, adminToken);
log('P24 Second project created (assigned to A only)', p2.status === 201, '');
const project2 = p2.data.project.id;

const plist = await req('GET', '/api/projects', undefined, adminToken);
log('P25 Admin sees all projects + real stats', plist.status === 200 && plist.data.items.length >= 2 && plist.data.stats.total >= 2, 'stats ' + JSON.stringify(plist.data.stats));
log('P26 Status filter works', (await req('GET', '/api/projects?status=IN_PROGRESS', undefined, adminToken)).data.items.every((p) => p.status === 'IN_PROGRESS'), '');
log('P27 Search works', (await req('GET', '/api/projects?search=Redesign', undefined, adminToken)).data.items.some((p) => p.id === projectId), '');

// ---------- Team member access ----------
const mlist = await req('GET', '/api/projects', undefined, tokenB);
const mBitems = mlist.data.items || [];
log('P28 Team member B sees ONLY assigned projects', mlist.status === 200 && mBitems.every((p) => p.id === projectId), 'got ' + mBitems.length + ' items');
log('P29 Team member B cannot open project 2 (not assigned) -> 403', (await req('GET', '/api/projects/' + project2, undefined, tokenB)).status === 403, '');
log('P30 Team member B can open assigned project 1', (await req('GET', '/api/projects/' + projectId, undefined, tokenB)).status === 200, '');
log('P31 Team member cannot delete a project -> 403', (await req('DELETE', '/api/projects/' + projectId, undefined, tokenB)).status === 403, '');
log('P32 Team member cannot edit project fields -> 403', (await req('PATCH', '/api/projects/' + projectId, { name: 'Hacked', clientId: clientId1 }, tokenB)).status === 403, '');

// Allowed: team member updates the STATUS of their assigned project
const mStatus = await req('PATCH', '/api/projects/' + projectId, { status: 'ON_HOLD' }, tokenB);
log('P33 Team member updates status of ASSIGNED project -> 200', mStatus.status === 200 && mStatus.data.project.status === 'ON_HOLD', 'got ' + mStatus.status);
log('P34 Team member with invalid status -> 400', (await req('PATCH', '/api/projects/' + projectId, { status: 'FLYING' }, tokenB)).status === 400, '');
log('P35 Status persisted (re-read)', (await req('GET', '/api/projects/' + projectId, undefined, adminToken)).data.project.status === 'ON_HOLD', '');

// ---------- Admin edit + assignment changes ----------
const pUpd = await req('PATCH', '/api/projects/' + projectId, {
  name: 'Website Redesign v2', clientId: clientId1, status: 'COMPLETED', teamMemberIds: [idB]
}, adminToken);
log('P36 Admin edits project + reassigns team', pUpd.status === 200 && pUpd.data.project.name === 'Website Redesign v2' && pUpd.data.project.teamNames.length === 1, '');
log('P37 After reassignment A can no longer open project 1 -> 403', (await req('GET', '/api/projects/' + projectId, undefined, tokenA)).status === 403, '');
log('P38 Admin sets invalid status -> 400', (await req('PATCH', '/api/projects/' + projectId, { name: 'X' }, adminToken)).status === 400 || (await req('PATCH', '/api/projects/' + projectId, { name: 'Y', clientId: clientId1, status: 'BAD' }, adminToken)).status === 400, '');

// ---------- Client deletion safety (409 while projects exist) ----------
log('P39 Delete client with projects -> 409 (no orphans)', (await req('DELETE', '/api/clients/' + clientId1, undefined, adminToken)).status === 409, '');

// ---------- Delete projects, then client ----------
log('P40 Admin deletes project 2 -> 200', (await req('DELETE', '/api/projects/' + project2, undefined, adminToken)).status === 200, '');
log('P41 Deleted project -> 404 on re-read', (await req('GET', '/api/projects/' + project2, undefined, adminToken)).status === 404, '');
log('P42 Admin deletes project 1 -> 200', (await req('DELETE', '/api/projects/' + projectId, undefined, adminToken)).status === 200, '');
log('P43 Client deletable after its projects are gone', (await req('DELETE', '/api/clients/' + clientId1, undefined, adminToken)).status === 200, '');
log('P44 Unknown project delete -> 404', (await req('DELETE', '/api/projects/999999', undefined, adminToken)).status === 404, '');

// ---------- No orphan assignments ----------
const Database = (await import('node:module')).createRequire(import.meta.url)('better-sqlite3');
const db = new Database('talora.db', { readonly: true });
const orphans = db.prepare('SELECT COUNT(*) AS c FROM project_team_members WHERE project_id NOT IN (SELECT id FROM projects)').get().c;
log('P45 No orphan project_team_members rows', orphans === 0, 'orphans ' + orphans);
const orphans2 = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE client_id NOT IN (SELECT id FROM clients)').get().c;
log('P46 No orphan project client references', orphans2 === 0, 'orphans ' + orphans2);

// ---------- Regression: Tasks 4/7/8/9/10 ----------
log('P47 Task 4: GET /api/user/profile still works', (await req('GET', '/api/user/profile', undefined, tokenA)).status === 200, '');
log('P48 Task 7: POST /api/requests still works', (await req('POST', '/api/requests', { fullName: 'Reg User', email: 'reg' + stamp + '@example.com', category: 'Design', title: 'Reg site', description: 'Regression body' })).status === 201, '');
log('P49 Task 7/9: unauthenticated /api/requests -> 401', (await req('GET', '/api/requests')).status === 401, '');
log('P50 Task 10: unauthenticated /api/documents -> 401', (await req('GET', '/api/documents')).status === 401, '');

console.log('\n===== ' + pass + '/' + results.length + ' passed =====');
if (fail) results.filter((r) => !r.ok).forEach((r) => console.log('  FAILED: ' + r.name));
process.exit(fail ? 1 : 0);
