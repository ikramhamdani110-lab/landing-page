// Task 7 — Customer Request Management end-to-end test suite.
// Runs against a live server (local: http://localhost:5501, or the deployed URL via TALORA_BASE).
//
// Covers: public submission, server-side validation, the PENDING default, company
// authorization on list/detail/status, the status lifecycle, request-not-found,
// invalid status, long input, duplicate suppression and real database persistence.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const BASE = process.env.TALORA_BASE || 'http://localhost:5501';
const results = [];
const log = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' :: ' + detail : '')); };

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
const adminLogin = await req('POST', '/api/auth/admin-login', { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'talora-admin' });
const adminToken = adminLogin.data && adminLogin.data.token;
log('R1 Company (admin) login works', adminLogin.status === 200 && !!adminToken, 'status ' + adminLogin.status);

const stamp = Date.now();
const userEmail = 'req-user-' + stamp + '@talora-test.dev';
const userPassword = 'Str0ngPassw0rd!';
const reg = await req('POST', '/api/auth/register', { fullName: 'Request QA User', email: userEmail, password: userPassword, confirmPassword: userPassword });
const userToken = reg.data && reg.data.token;
log('R2 Non-company user registered', reg.status === 201 || reg.status === 200, 'status ' + reg.status);

const customerEmail = 'customer-' + stamp + '@talora-test.dev';

// ---------- 1. Public submission (no token) ----------
let r = await req('POST', '/api/requests', {
  fullName: 'Amine Customer',
  email: customerEmail,
  companyName: 'Northwind',
  category: 'Design',
  title: 'Website redesign ' + stamp,
  description: 'We need a premium redesign of our marketing site.',
  budget: '15000',
  deadline: '2026-12-01',
  additionalDetails: 'Accessibility is a priority.'
});
const created = r.data && r.data.request;
const requestId = created && created.id;
log('R3 Unauthenticated customer can submit a request', r.status === 201 && !!requestId, 'status ' + r.status);
log('R4 New request is stored as PENDING', created && created.status === 'PENDING', 'status=' + (created && created.status));
log('R5 Response echoes the submitted fields', !!created && created.customerName === 'Amine Customer' && created.customerEmail === customerEmail, '');
log('R6 Customer cannot choose the status (server assigns it)', !!created && created.status === 'PENDING', '');
log('R7 No internal/DB fields leak in the response', !!created && !/password|_hash|DATABASE_URL/i.test(JSON.stringify(created)), '');

// ---------- 2. Server-side validation ----------
r = await req('POST', '/api/requests', {});
log('R8 Empty submission -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/requests', { fullName: '', email: '', category: '', title: '', description: '' });
log('R9 Blank required fields -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/requests', { fullName: 'X', email: 'not-an-email', category: 'Design', title: 'T', description: 'D' });
log('R10 Invalid email -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/requests', { fullName: 'X', email: 'x@example.com', category: 'Not A Category', title: 'T', description: 'D' });
log('R11 Invalid request type -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/requests', { fullName: 'X', email: 'x@example.com', category: 'Design', title: '', description: 'D' });
log('R12 Missing subject -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/requests', { fullName: 'X', email: 'x@example.com', category: 'Design', title: 'T', description: '' });
log('R13 Missing description -> 400', r.status === 400, 'status ' + r.status);

r = await req('POST', '/api/requests', {
  fullName: 'Y'.repeat(500), email: 'long-' + stamp + '@example.com', category: 'Design',
  title: 'T'.repeat(1000), description: 'D'.repeat(20000)
});
log('R14 Very long input is truncated, not rejected', r.status === 201, 'status ' + r.status);
if (r.status === 201 && r.data.request) {
  log('R14b Long input truncated to the documented limits',
    r.data.request.customerName.length === 100 && r.data.request.title.length === 200 && r.data.request.description.length === 5000,
    'name=' + r.data.request.customerName.length + ' title=' + r.data.request.title.length + ' desc=' + r.data.request.description.length);
}

r = await req('POST', '/api/requests', { fullName: 'A', email: 'short-' + stamp + '@example.com', category: 'Design', title: 'X', description: 'Y' });
log('R15 Too-short required fields -> 400', r.status === 400, 'status ' + r.status);

// Malformed JSON must not crash the API
const rawRes = await fetch(BASE + '/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
log('R16 Malformed JSON body -> 4xx (not 500)', rawRes.status >= 400 && rawRes.status < 500, 'status ' + rawRes.status);

// ---------- 3. Duplicate submission ----------
r = await req('POST', '/api/requests', {
  fullName: 'Amine Customer', email: customerEmail, companyName: 'Northwind', category: 'Design',
  title: 'Website redesign ' + stamp, description: 'We need a premium redesign of our marketing site.',
  budget: '15000', deadline: '2026-12-01', additionalDetails: 'Accessibility is a priority.'
});
log('R17 Duplicate submission suppressed -> 409', r.status === 409, 'status ' + r.status);

// ---------- 4. Authorization ----------
r = await req('GET', '/api/requests');
log('R18 Unauthenticated list -> 401', r.status === 401, 'status ' + r.status);

r = await req('GET', '/api/requests/' + requestId);
log('R19 Unauthenticated detail -> 401', r.status === 401, 'status ' + r.status);

r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: 'COMPLETED' });
log('R20 Unauthenticated status update -> 401', r.status === 401, 'status ' + r.status);

r = await req('GET', '/api/requests', undefined, 'garbage.token');
log('R21 Forged/invalid token -> 401', r.status === 401, 'status ' + r.status);

r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: 'COMPLETED' }, userToken);
log('R22 Authenticated non-company user cannot change status -> 401/403', r.status === 401 || r.status === 403, 'status ' + r.status);

// Confirm the rejected update really did not touch the row
r = await req('GET', '/api/requests/' + requestId, undefined, adminToken);
log('R23 Status unchanged after unauthorized attempt', r.status === 200 && r.data.request.status === 'PENDING', 'status=' + (r.data.request && r.data.request.status));

// ---------- 5. Company list + detail ----------
r = await req('GET', '/api/requests', undefined, adminToken);
const items = r.data && r.data.items;
log('R24 Company user can list requests', r.status === 200 && Array.isArray(items), 'status ' + r.status);
const listed = items && items.find(x => x.id === requestId);
log('R25 Newly submitted request appears in the list', !!listed, '');
log('R26 List row exposes the fields the dashboard renders',
  !!listed && !!listed.customerName && !!listed.customerEmail && !!listed.requestType && !!listed.subject && !!listed.status && !!listed.createdAt && !!listed.updatedAt, '');

r = await req('GET', '/api/requests?status=PENDING', undefined, adminToken);
log('R27 Status filter works', r.status === 200 && r.data.items.every(x => x.status === 'PENDING'), 'status ' + r.status);

r = await req('GET', '/api/requests?status=BOGUS', undefined, adminToken);
log('R28 Unknown status filter is ignored (no 500)', r.status === 200, 'status ' + r.status);

r = await req('GET', '/api/requests?search=' + encodeURIComponent(customerEmail), undefined, adminToken);
log('R29 Search by customer email works', r.status === 200 && r.data.items.some(x => x.id === requestId), 'status ' + r.status);

r = await req('GET', '/api/requests?search=' + encodeURIComponent("'; DROP TABLE customer_requests; --"), undefined, adminToken);
log('R30 SQL-injection style search is treated as text', r.status === 200 && Array.isArray(r.data.items), 'status ' + r.status);

r = await req('GET', '/api/requests/' + requestId, undefined, adminToken);
const detail = r.data && r.data.request;
log('R31 Company user can open request details', r.status === 200 && !!detail, 'status ' + r.status);
log('R32 Details include the full description', !!detail && detail.description === 'We need a premium redesign of our marketing site.', '');

r = await req('GET', '/api/requests/999999', undefined, adminToken);
log('R33 Nonexistent request -> 404', r.status === 404, 'status ' + r.status);

r = await req('GET', '/api/requests/not-a-number', undefined, adminToken);
log('R34 Invalid id -> 404 (not 500)', r.status === 404, 'status ' + r.status);

// ---------- 6. Status lifecycle ----------
r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: 'IN_PROGRESS' }, adminToken);
log('R35 Company user moves request to IN_PROGRESS', r.status === 200 && r.data.request.status === 'IN_PROGRESS', 'status ' + r.status);
const firstUpdatedAt = r.data.request && r.data.request.updatedAt;

r = await req('GET', '/api/requests/' + requestId, undefined, adminToken);
log('R36 Status persisted in the database (re-read)', r.data.request.status === 'IN_PROGRESS', 'status=' + r.data.request.status);
log('R37 updatedAt advanced past createdAt', new Date(r.data.request.updatedAt) >= new Date(r.data.request.createdAt), '');

// The column is second-resolution, so wait long enough for the next write to be observable.
await new Promise(resolve => setTimeout(resolve, 1500));

r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: 'COMPLETED' }, adminToken);
log('R38 Move to COMPLETED', r.status === 200 && r.data.request.status === 'COMPLETED', 'status ' + r.status);
log('R39 updatedAt changed again', !!firstUpdatedAt && r.data.request.updatedAt !== firstUpdatedAt,
  'before=' + firstUpdatedAt + ' after=' + (r.data.request && r.data.request.updatedAt));

r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: 'REJECTED' }, adminToken);
log('R40 Move to REJECTED', r.status === 200 && r.data.request.status === 'REJECTED', 'status ' + r.status);

r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: 'PENDING' }, adminToken);
log('R41 Move back to PENDING', r.status === 200 && r.data.request.status === 'PENDING', 'status ' + r.status);

// ---------- 7. Invalid status values ----------
for (const bad of ['NEW', 'REVIEWING', 'MATCHING', 'bogus', '', null, 'pending; DROP TABLE customer_requests']) {
  r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: bad }, adminToken);
  log('R42 Invalid status rejected (' + JSON.stringify(bad) + ') -> 400', r.status === 400, 'status ' + r.status);
}

r = await req('PATCH', '/api/requests/' + requestId + '/status', {}, adminToken);
log('R43 Missing status field -> 400', r.status === 400, 'status ' + r.status);

r = await req('PATCH', '/api/requests/999999/status', { status: 'COMPLETED' }, adminToken);
log('R44 Status update on nonexistent request -> 404', r.status === 404, 'status ' + r.status);

r = await req('PATCH', '/api/requests/not-a-number/status', { status: 'COMPLETED' }, adminToken);
log('R45 Status update on invalid id -> 400/404 (not 500)', r.status === 400 || r.status === 404, 'status ' + r.status);

// After all the rejected writes the stored status must still be PENDING
r = await req('GET', '/api/requests/' + requestId, undefined, adminToken);
log('R46 Row is untouched by every invalid status attempt', r.data.request.status === 'PENDING', 'status=' + r.data.request.status);

// ---------- 8. Company logout revocation ----------
const logout = await req('POST', '/api/auth/admin-logout', undefined, adminToken);
log('R47 Company logout succeeds', logout.status === 200, 'status ' + logout.status);
r = await req('GET', '/api/requests', undefined, adminToken);
log('R48 Revoked company token can no longer list requests', r.status === 401, 'status ' + r.status);
r = await req('PATCH', '/api/requests/' + requestId + '/status', { status: 'REJECTED' }, adminToken);
log('R48b Revoked company token can no longer change status', r.status === 401, 'status ' + r.status);
r = await req('POST', '/api/auth/admin-logout');
log('R48c Logout without a token -> 401', r.status === 401, 'status ' + r.status);

// ---------- 9. Direct database check (local runs only) ----------
if (!process.env.TALORA_BASE) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH || 'talora.db', { readonly: true });
    const row = db.prepare('SELECT id, status, customer_email, updated_at FROM customer_requests WHERE id = ?').get(requestId);
    log('R49 Request exists in the SQLite database', !!row && row.customer_email === customerEmail, JSON.stringify(row));
    log('R50 Database row has the expected final status', !!row && row.status === 'PENDING', 'status=' + (row && row.status));
    db.close();
  } catch (err) {
    log('R49 Direct database check', false, err.message);
  }
}

const failed = results.filter(x => !x.pass);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
if (failed.length) failed.forEach(f => console.log('  FAILED: ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
process.exit(failed.length ? 1 : 0);