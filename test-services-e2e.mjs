// Task 6 - Service Management end-to-end test suite (runs against local server)
// Covers: authorization (unauth / user-token / admin-token), CRUD, validation,
// public retrieval (active-only), and DB persistence.
const BASE = 'http://localhost:5501';
const results = [];
const log = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' :: ' + detail : '')); };

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// ---- Setup: an admin token and a normal USER token (must not have admin power) ----
let r = await req('POST', '/api/auth/login', { username: 'admin', password: 'talora-admin' });
const adminToken = r.data && r.data.token;
log('S1 Admin login works', r.status === 200 && !!adminToken, 'status ' + r.status);

const email = 'svc-user-' + Date.now() + '@talora-test.dev';
const password = 'Str0ngPassw0rd!';
r = await req('POST', '/api/auth/register', { fullName: 'Svc Test User', email, password, confirmPassword: password });
const userToken = r.data && r.data.token;
log('S2 User registered', r.status === 201 || r.status === 200, 'status ' + r.status);

// ---- Authorization tests ----
r = await req('POST', '/api/admin/services', { title: 'Hax', description: 'x', status: 'active' });
log('S3 Unauthenticated create -> 401', r.status === 401, 'status ' + r.status);

r = await req('PUT', '/api/admin/services/1', { title: 'Hax', description: 'x', status: 'active' });
log('S4 Unauthenticated update -> 401', r.status === 401, 'status ' + r.status);

r = await req('DELETE', '/api/admin/services/1');
log('S5 Unauthenticated delete -> 401', r.status === 401, 'status ' + r.status);

r = await req('POST', '/api/admin/services', { title: 'Hax', description: 'x', status: 'active' }, userToken);
log('S6 Authenticated non-admin user create -> 401/403', r.status === 401 || r.status === 403, 'status ' + r.status);

r = await req('PUT', '/api/admin/services/1', { title: 'Hax', description: 'x', status: 'active' }, userToken);
log('S7 Non-admin user update -> 401/403', r.status === 401 || r.status === 403, 'status ' + r.status);

r = await req('DELETE', '/api/admin/services/1', null, userToken);
log('S8 Non-admin user delete -> 401/403', r.status === 401 || r.status === 403, 'status ' + r.status);

r = await req('GET', '/api/admin/services', null, userToken);
log('S9 Non-admin user cannot list all services', r.status === 401 || r.status === 403, 'status ' + r.status);

// ---- Validation tests (admin token) ----
r = await req('POST', '/api/admin/services', {}, adminToken);
log('S10 Missing fields -> 400', r.status === 400, JSON.stringify(r.data).slice(0, 120));

r = await req('POST', '/api/admin/services', { title: '', description: 'd', status: 'active' }, adminToken);
log('S11 Empty title -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/admin/services', { title: 'T', description: 'd', status: 'weird' }, adminToken);
log('S12 Invalid status -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/admin/services', { title: 'x'.repeat(201), description: 'd', status: 'active' }, adminToken);
log('S13 Title > 200 chars -> 400', r.status === 400, 'status ' + r.status);

// ---- CRUD lifecycle ----
r = await req('POST', '/api/admin/services', { title: 'E2E Test Service', description: 'Created by test-services-e2e.', icon: 'bx-test', status: 'active' }, adminToken);
const created = r.data && r.data.item;
const id = created && created.id;
log('S14 Create service -> 201', r.status === 201 && !!id, JSON.stringify(r.data).slice(0, 140));

r = await req('GET', '/api/admin/services', null, adminToken);
const listed = r.data && r.data.items;
log('S15 Admin list includes created service', r.status === 200 && Array.isArray(listed) && listed.some(s => s.id === id), 'status ' + r.status);

// Public API shows it while active
r = await req('GET', '/api/services');
let pub = r.data && r.data.items;
log('S16 Public /api/services shows active service', r.status === 200 && pub.some(s => s.id === id), 'status ' + r.status);
log('S17 Public payload exposes no draft/inactive rows', pub.every(s => s.status === 'active'), '');

// Update
r = await req('PUT', '/api/admin/services/' + id, { title: 'E2E Test Service (updated)', description: 'Updated description.', icon: 'bx-test', status: 'active' }, adminToken);
log('S18 Update service -> 200 + new title', r.status === 200 && r.data.item && r.data.item.title === 'E2E Test Service (updated)', 'status ' + r.status);

r = await req('GET', '/api/services');
pub = r.data && r.data.items;
log('S19 Public API reflects the update', pub.some(s => s.id === id && s.title === 'E2E Test Service (updated)'), '');

// Deactivate: hidden from public, still visible to admin
r = await req('PUT', '/api/admin/services/' + id, { title: 'E2E Test Service (updated)', description: 'Updated description.', icon: 'bx-test', status: 'inactive' }, adminToken);
log('S20 Deactivate service -> 200', r.status === 200 && r.data.item && r.data.item.status === 'inactive', 'status ' + r.status);

r = await req('GET', '/api/services');
pub = r.data && r.data.items;
log('S21 Inactive service hidden from public API', !pub.some(s => s.id === id), '');

r = await req('GET', '/api/admin/services', null, adminToken);
log('S22 Inactive service still visible to admin', r.status === 200 && r.data.items.some(s => s.id === id), '');

// Not found handling
r = await req('GET', '/api/admin/services/999999', null, adminToken);
log('S23 GET nonexistent service -> 404', r.status === 404, 'status ' + r.status);

r = await req('PUT', '/api/admin/services/999999', { title: 'x', description: 'y', status: 'active' }, adminToken);
log('S24 Update nonexistent service -> 404', r.status === 404, 'status ' + r.status);

r = await req('DELETE', '/api/admin/services/999999', null, adminToken);
log('S25 Delete nonexistent service -> 404', r.status === 404, 'status ' + r.status);

r = await req('GET', '/api/admin/services/not-a-number', null, adminToken);
log('S26 Invalid id -> 404 (not 500)', r.status === 404, 'status ' + r.status);

// Delete
r = await req('DELETE', '/api/admin/services/' + id, null, adminToken);
log('S27 Delete service -> 200', r.status === 200, 'status ' + r.status);

r = await req('GET', '/api/admin/services', null, adminToken);
log('S28 Deleted service gone from admin list', !r.data.items.some(s => s.id === id), '');

r = await req('GET', '/api/services');
pub = r.data && r.data.items;
log('S29 Deleted service gone from public API', !pub.some(s => s.id === id), '');

const failed = results.filter(x => !x.pass);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
process.exit(failed.length ? 1 : 0);
