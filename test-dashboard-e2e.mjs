// Task 5 - Customer Dashboard end-to-end test suite (runs against local server)
const BASE = 'http://localhost:5501';
const results = [];
const log = (name, pass, detail) => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' :: ' + detail : '')); };

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { }
  return { status: res.status, data };
}

const ts = Date.now();
const emailA = 'dash-a-' + ts + '@talora-test.dev';
const emailB = 'dash-b-' + ts + '@talora-test.dev';
const password = 'Str0ngPassw0rd!';

// T1 Registration + T2 Login for User A and User B
let r = await req('POST', '/api/auth/register', { fullName: 'Dash User A', email: emailA, password, confirmPassword: password });
log('T1a Register User A', r.status === 201 || r.status === 200, 'status ' + r.status);
r = await req('POST', '/api/auth/register', { fullName: 'Dash User B', email: emailB, password, confirmPassword: password });
log('T1b Register User B', r.status === 201 || r.status === 200, 'status ' + r.status);
r = await req('POST', '/api/auth/user-login', { email: emailA, password });
const tokenA = r.data && r.data.token;
log('T2a Login User A', r.status === 200 && !!tokenA, 'status ' + r.status);
r = await req('POST', '/api/auth/user-login', { email: emailB, password });
const tokenB = r.data && r.data.token;
log('T2b Login User B', r.status === 200 && !!tokenB, 'status ' + r.status);

// T3 GET profile returns real DB data for A
r = await req('GET', '/api/user/profile', null, tokenA);
log('T3 Profile GET returns user A', r.status === 200 && r.data.user && r.data.user.email === emailA && r.data.user.fullName === 'Dash User A', JSON.stringify(r.data).slice(0, 160));
log('T3b No secrets leaked', !/password|hash|token_secret/i.test(JSON.stringify(r.data)), '');

// T4 PUT updates name+email and persists
r = await req('PUT', '/api/user/profile', { fullName: 'Dash A Updated', email: emailA }, tokenA);
log('T4a PUT updates profile', r.status === 200 && r.data.user && r.data.user.fullName === 'Dash A Updated', JSON.stringify(r.data).slice(0, 160));
r = await req('GET', '/api/user/profile', null, tokenA);
log('T4b Update persisted in DB', r.status === 200 && r.data.user.fullName === 'Dash A Updated', '');

// T4c protected fields rejected/ignored
r = await req('PUT', '/api/user/profile', { role: 'admin', id: 999, password_hash: 'x' }, tokenA);
const after = r.data && r.data.user;
log('T4c Protected fields ignored', r.status !== 500 && (!after || (after.role === 'user' && after.id !== 999)), JSON.stringify(r.data).slice(0, 140));

// T5 Invalid input -> 400, nothing changed
r = await req('PUT', '/api/user/profile', { fullName: '', email: 'bad' }, tokenA);
log('T5 Invalid update -> 400', r.status === 400, 'status ' + r.status);
r = await req('GET', '/api/user/profile', null, tokenA);
log('T5b DB unchanged after invalid update', r.status === 200 && r.data.user.fullName === 'Dash A Updated', '');

// T6 GET/PUT without token -> 401
r = await req('GET', '/api/user/profile');
log('T6a GET no token -> 401', r.status === 401, 'status ' + r.status);
r = await req('PUT', '/api/user/profile', { fullName: 'Hacker' });
log('T6b PUT no token -> 401', r.status === 401, 'status ' + r.status);

// T6c forged/garbage token -> 401
r = await req('GET', '/api/user/profile', null, 'abc.def.ghi');
log('T6c Garbage token -> 401', r.status === 401, 'status ' + r.status);

// T7 User isolation: A cannot read/update B
r = await req('GET', '/api/user/profile', null, tokenA);
const idA = r.data && r.data.user && r.data.user.id;
r = await req('GET', '/api/user/profile', null, tokenB);
const idB = r.data && r.data.user && r.data.user.id;
log('T7a Distinct ids', idA !== idB, 'A=' + idA + ' B=' + idB);
r = await req('PUT', '/api/user/profile', { fullName: 'Hijacked B' }, tokenA);
const hijackEmail = r.data && r.data.user && r.data.user.email;
log('T7b A cannot update B (PUT is token-scoped)', r.status !== 200 || hijackEmail === emailA, JSON.stringify(r.data).slice(0, 140));
r = await req('GET', '/api/user/profile', null, tokenB);
log('T7c B data intact', r.status === 200 && r.data.user.fullName === 'Dash User B', '');

// T8 Logout revokes token -> 401 afterwards
r = await req('POST', '/api/auth/logout', null, tokenB);
log('T8a Logout', r.status === 200, 'status ' + r.status);
r = await req('GET', '/api/user/profile', null, tokenB);
log('T8b Revoked token -> 401', r.status === 401, 'status ' + r.status);
r = await req('PUT', '/api/user/profile', { fullName: 'X' }, tokenB);
log('T8c Revoked token PUT -> 401', r.status === 401, 'status ' + r.status);

// T9 Admin isolation: user token cannot touch admin settings
const adminLogin = await req('POST', '/api/auth/login', { username: 'admin', password: 'talora-admin' });
log('T9a Admin login still works', adminLogin.status === 200 && !!(adminLogin.data && adminLogin.data.token), 'status ' + adminLogin.status);
r = await req('GET', '/api/website-settings', null, tokenA);
log('T9b User token blocked from admin settings', r.status === 401 || r.status === 403, 'status ' + r.status);
r = await req('GET', '/api/auth/me', null, tokenA);
log('T9c /api/auth/me returns user', r.status === 200 && r.data.user && r.data.user.email === emailA, '');

const failed = results.filter(x => !x.pass);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
process.exit(failed.length ? 1 : 0);
