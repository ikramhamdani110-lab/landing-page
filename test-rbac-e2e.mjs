// Task 9 — RBAC end-to-end test suite (API-level, no browser).
//
//   1) node serve.js
//   2) node test-rbac-e2e.mjs
//
// Everything is exercised through real HTTP requests against the running API so
// the backend is proven authoritative, not the frontend.
const BASE = process.env.RBAC_BASE_URL || 'http://localhost:5501';
const results = [];
const log = (name, pass, detail) => {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' :: ' + detail : ''));
};

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const stamp = Date.now();
const adminEmail = `rbac-admin-${stamp}@talora-test.dev`;
const empEmail = `rbac-emp-${stamp}@talora-test.dev`;
const password = 'Str0ngPassw0rd!';

const content = (over = {}) => ({
  title: 'RBAC Test ' + stamp, description: 'RBAC e2e record.', category: 'General',
  status: 'published', section: 'General', ...over
});

// ---------------------------------------------------------------- accounts
let r = await req('POST', '/api/auth/register', { fullName: 'RBAC Admin', email: adminEmail, password, confirmPassword: password });
const adminId = r.data && r.data.user && r.data.user.id;
log('Setup: register admin account (defaults to EMPLOYEE)', !!adminId, JSON.stringify(r.data));

r = await req('POST', '/api/auth/register', { fullName: 'RBAC Employee', email: empEmail, password, confirmPassword: password });
const empId = r.data && r.data.user && r.data.user.id;
log('Setup: register employee account', !!empId, JSON.stringify(r.data));

r = await req('POST', '/api/auth/user-login', { email: adminEmail, password });
const adminToken = r.data && r.data.token;
log('Setup: admin account login', r.status === 200 && !!adminToken, 'status ' + r.status);

r = await req('POST', '/api/auth/user-login', { email: empEmail, password });
const empToken = r.data && r.data.token;
log('Setup: employee account login', r.status === 200 && !!empToken, 'status ' + r.status);

// The env-configured CMS admin token is the built-in ADMIN principal.
r = await req('POST', '/api/auth/login', { username: 'admin', password: 'talora-admin' });
const cmsToken = r.data && r.data.token;
log('Setup: CMS admin login (env credentials)', r.status === 200 && !!cmsToken, 'status ' + r.status);

// --------------------------------------------------- promote admin account
r = await req('PUT', `/api/admin/users/${adminId}`, { role: 'ADMIN' }, empToken);
log('EMPPLOYEE cannot promote anyone -> 403', r.status === 403, 'status ' + r.status);

r = await req('PUT', `/api/admin/users/${adminId}`, { role: 'ADMIN' }, cmsToken);
log('CMS ADMIN can set a role', r.status === 200, JSON.stringify(r.data));

// A fresh login is not required: the role is read from the DB on every request.
r = await req('GET', '/api/auth/me', null, adminToken);
log('Promoted user is reported as ADMIN by /api/auth/me', r.data && r.data.user && r.data.user.role === 'ADMIN', JSON.stringify(r.data));

// ------------------------------------------------------- unauthenticated
r = await req('GET', '/api/content');
log('Unauthenticated GET /api/content -> 401', r.status === 401, 'status ' + r.status);
r = await req('POST', '/api/content', content());
log('Unauthenticated POST /api/content -> 401', r.status === 401, 'status ' + r.status);
r = await req('GET', '/api/admin/users');
log('Unauthenticated GET /api/admin/users -> 401', r.status === 401, 'status ' + r.status);

// --------------------------------------------------------------- ADMIN
r = await req('POST', '/api/content', content(), adminToken);
const recordId = r.data && r.data.item && r.data.item.id;
log('ADMIN can create', r.status === 201 && !!recordId, 'status ' + r.status);

r = await req('GET', `/api/content/${recordId}`, null, adminToken);
log('ADMIN can read', r.status === 200, 'status ' + r.status);

r = await req('PUT', `/api/content/${recordId}`, content({ title: 'RBAC Admin Edit ' + stamp }), adminToken);
log('ADMIN can update (incl. status)', r.status === 200, 'status ' + r.status);

r = await req('GET', '/api/admin/services', null, adminToken);
log('ADMIN can read services', r.status === 200, 'status ' + r.status);

r = await req('GET', '/api/admin/users', null, adminToken);
log('ADMIN can list users/roles', r.status === 200 && Array.isArray(r.data.users), 'status ' + r.status);
log('ADMIN user list leaks no password hash', !/password_hash|"hash"/i.test(JSON.stringify(r.data)), '');

// -------------------------------------------------------------- EMPLOYEE
r = await req('GET', '/api/content', null, empToken);
log('EMPLOYEE can read content', r.status === 200, 'status ' + r.status);

r = await req('GET', `/api/content/${recordId}`, null, empToken);
log('EMPLOYEE can read one record', r.status === 200, 'status ' + r.status);

// Employee updates permitted fields; `status` is admin-only and must be ignored.
const before = (await req('GET', `/api/content/${recordId}`, null, empToken)).data.item;
r = await req('PUT', `/api/content/${recordId}`,
  content({ title: 'RBAC Employee Edit ' + stamp, description: 'Edited by employee.', status: 'draft' }), empToken);
const after = r.data && r.data.item;
log('EMPLOYEE can update permitted fields', r.status === 200 && after && after.title === 'RBAC Employee Edit ' + stamp,
  r.status + ' ' + JSON.stringify(r.data));
log('EMPLOYEE update did NOT change protected field (status)',
  after && after.status === before.status, before.status + ' -> ' + (after && after.status));

r = await req('POST', '/api/content', content(), empToken);
log('EMPLOYEE cannot create -> 403', r.status === 403, 'status ' + r.status);

r = await req('DELETE', `/api/content/${recordId}`, null, empToken);
log('EMPLOYEE cannot delete -> 403', r.status === 403, 'status ' + r.status);

r = await req('GET', '/api/admin/services', null, empToken);
log('EMPLOYEE cannot read admin services CMS -> 403', r.status === 403, 'status ' + r.status);

r = await req('GET', '/api/services');
log('EMPLOYEE (and anyone) can read public services', r.status === 200 && Array.isArray(r.data.items), 'status ' + r.status);

r = await req('POST', '/api/admin/services', { title: 'x', description: 'y', icon: '', status: 'active' }, empToken);
log('EMPLOYEE cannot create services -> 403', r.status === 403, 'status ' + r.status);

r = await req('GET', '/api/website-settings', null, empToken);
log('EMPLOYEE cannot read website settings -> 403', r.status === 403, 'status ' + r.status);

r = await req('PUT', '/api/website-settings', { hero_title: 'HACKED' }, empToken);
log('EMPLOYEE cannot write website settings -> 403', r.status === 403, 'status ' + r.status);

r = await req('GET', '/api/admin/users', null, empToken);
log('EMPLOYEE cannot list users -> 403', r.status === 403, 'status ' + r.status);

// ------------------------------------------------- privilege escalation
r = await req('PUT', `/api/user/profile`, { fullName: 'Hacker', role: 'ADMIN' }, empToken);
log('EMPLOYEE cannot self-escalate via profile update',
  r.status === 200 ? !(r.data.user && r.data.user.role === 'ADMIN') : r.status === 400,
  JSON.stringify(r.data));

r = await req('GET', '/api/auth/me', null, empToken);
log('EMPLOYEE role is still EMPLOYEE after escalation attempt', r.data.user.role === 'EMPLOYEE', JSON.stringify(r.data));

r = await req('PUT', `/api/admin/users/${empId}`, { role: 'ADMIN' }, empToken);
log('EMPLOYEE cannot assign ADMIN to self -> 403', r.status === 403, 'status ' + r.status);

r = await req('PUT', `/api/admin/users/${empId}`, { role: 'superadmin' }, cmsToken);
log('Invalid role value rejected -> 400', r.status === 400, JSON.stringify(r.data));

// ---------------------------------------------------------- admin cleanup
r = await req('DELETE', `/api/content/${recordId}`, null, adminToken);
log('ADMIN can delete', r.status === 200, 'status ' + r.status);

r = await req('GET', `/api/content/${recordId}`, null, adminToken);
log('Deleted record is gone', r.status === 404, 'status ' + r.status);

const failed = results.filter(x => !x.pass);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
if (failed.length) console.log('Failed: ' + failed.map(f => f.name).join(' | '));
process.exit(failed.length ? 1 : 0);
