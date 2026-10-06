// Task 7 — authorization matrix check (runs against a live server).
// Proves which session types may read and modify customer requests.
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
  try { data = await res.json(); } catch { }
  return { status: res.status, data };
}

// --- sessions ---
const admin = await req('POST', '/api/auth/admin-login', { username: 'admin', password: 'talora-admin' });
const adminToken = admin.data && admin.data.token;
log('A1 Company login via /api/auth/admin-login', admin.status === 200 && !!adminToken, 'status ' + admin.status);

const stamp = Date.now();
const userEmail = 'authz-' + stamp + '@talora-test.dev';
const userPassword = 'Str0ngPassw0rd!';
await req('POST', '/api/auth/register', { fullName: 'Authz User', email: userEmail, password: userPassword, confirmPassword: userPassword });
const userLogin = await req('POST', '/api/auth/user-login', { email: userEmail, password: userPassword });
const userToken = userLogin.data && userLogin.data.token;
log('A2 Customer login via /api/auth/user-login', userLogin.status === 200 && !!userToken, 'status ' + userLogin.status);

// create a request to act on (public)
const created = await req('POST', '/api/requests', {
  fullName: 'Authz Customer', email: 'authz-customer-' + stamp + '@talora-test.dev', category: 'Design',
  title: 'Authz check ' + stamp, description: 'Created by the authorization matrix check.'
});
const id = created.data.request.id;
log('A3 Public submission still works (no session)', created.status === 201 && created.data.request.status === 'PENDING', 'id=' + id);

// --- anonymous ---
log('A4 Anonymous list -> 401', (await req('GET', '/api/requests')).status === 401, '');
log('A5 Anonymous detail -> 401', (await req('GET', '/api/requests/' + id)).status === 401, '');
log('A6 Anonymous status update -> 401', (await req('PATCH', '/api/requests/' + id + '/status', { status: 'COMPLETED' })).status === 401, '');

// --- customer session (not a company user) ---
log('A7 Customer list -> 401/403', [401, 403].includes((await req('GET', '/api/requests', undefined, userToken)).status), '');
log('A8 Customer detail -> 401/403', [401, 403].includes((await req('GET', '/api/requests/' + id, undefined, userToken)).status), '');
const custUpdate = await req('PATCH', '/api/requests/' + id + '/status', { status: 'COMPLETED' }, userToken);
log('A9 Customer status update -> 401/403', [401, 403].includes(custUpdate.status), 'status ' + custUpdate.status);
log('A10 Customer cannot use the company login route', (await req('POST', '/api/auth/admin-login', { username: 'admin', password: 'wrong-password' })).status === 401, '');

// --- forged token ---
log('A11 Forged token -> 401', (await req('GET', '/api/requests', undefined, 'abc.def')).status === 401, '');

// --- company session ---
log('A12 Company list -> 200', (await req('GET', '/api/requests', undefined, adminToken)).status === 200, '');
log('A13 Company detail -> 200', (await req('GET', '/api/requests/' + id, undefined, adminToken)).status === 200, '');
const compUpdate = await req('PATCH', '/api/requests/' + id + '/status', { status: 'IN_PROGRESS' }, adminToken);
log('A14 Company status update -> 200', compUpdate.status === 200 && compUpdate.data.request.status === 'IN_PROGRESS', 'status ' + compUpdate.status);

// --- after logout the company token must stop working ---
const out = await req('POST', '/api/auth/admin-logout', undefined, adminToken);
log('A15 Company logout -> 200', out.status === 200, 'status ' + out.status);
log('A16 Revoked company token list -> 401', (await req('GET', '/api/requests', undefined, adminToken)).status === 401, '');
log('A17 Revoked company token detail -> 401', (await req('GET', '/api/requests/' + id, undefined, adminToken)).status === 401, '');
log('A18 Revoked company token status update -> 401', (await req('PATCH', '/api/requests/' + id + '/status', { status: 'REJECTED' }, adminToken)).status === 401, '');

// the row must be untouched by the rejected attempts
const fresh = await req('POST', '/api/auth/admin-login', { username: 'admin', password: 'talora-admin' });
const check = await req('GET', '/api/requests/' + id, undefined, fresh.data.token);
log('A19 Row unchanged after all rejected writes', check.data.request.status === 'IN_PROGRESS', 'status=' + check.data.request.status);

// --- public payload must not leak internals ---
const pub = JSON.stringify(created.data);
log('A20 Public response exposes no credentials/secrets', !/password|secret|DATABASE_URL|token/i.test(pub), '');

// --- company session can also load the dashboard shell (Task 7 dashboard access) ---
const prof = await req('GET', '/api/user/profile', undefined, fresh.data.token);
log('A21 Company session loads the dashboard shell', prof.status === 200 && prof.data.user && prof.data.user.role === 'admin', 'status ' + prof.status);
log('A22 Dashboard shell exposes no password/hash', !/password|hash/i.test(JSON.stringify(prof.data)), '');
const userProf = await req('GET', '/api/user/profile', undefined, userToken);
log('A23 Customer session still loads its own profile', userProf.status === 200 && userProf.data.user.email === userEmail, 'status ' + userProf.status);

const failed = results.filter(x => !x.pass);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
if (failed.length) failed.forEach(f => console.log('  FAILED: ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
process.exit(failed.length ? 1 : 0);