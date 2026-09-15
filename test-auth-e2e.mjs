// Task 4 - End-to-end authentication test suite (runs against local server)
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

const email = 'qa-user-' + Date.now() + '@talora-test.dev';
const password = 'Str0ngPassw0rd!';

// TEST 1 - Registration
let r = await req('POST', '/api/auth/register', { fullName: 'Test User', email, password, confirmPassword: password });
log('T1 Register', r.status === 201 || r.status === 200, JSON.stringify(r.data));
const regToken = r.data && r.data.token;

// TEST 2 - Duplicate registration
r = await req('POST', '/api/auth/register', { fullName: 'Test User', email, password, confirmPassword: password });
log('T2 Duplicate registration rejected', r.status === 400 || r.status === 409, 'status ' + r.status);

// TEST 3 - Login
r = await req('POST', '/api/auth/user-login', { email, password });
const userToken = (r.data && r.data.token) || regToken;
log('T3 Login', r.status === 200 && !!userToken, 'status ' + r.status);

// TEST 4 - Wrong password
r = await req('POST', '/api/auth/user-login', { email, password: 'WrongPassword123' });
log('T4 Wrong password -> 401 generic', r.status === 401, JSON.stringify(r.data));

// TEST 5 - me without token
r = await req('GET', '/api/auth/me');
log('T5 Me without auth -> 401', r.status === 401, 'status ' + r.status);

// TEST 6 - me with token
r = await req('GET', '/api/auth/me', null, userToken);
const meOk = r.status === 200 && r.data && r.data.user && r.data.user.email === email;
log('T6 Me with auth returns profile', meOk, JSON.stringify(r.data));
log('T6b No password/hash leaked', !/password|hash/i.test(JSON.stringify(r.data)), '');

// TEST 7 - Profile endpoint with token
r = await req('GET', '/api/user/profile', null, userToken);
log('T7 Profile endpoint with token', r.status === 200, 'status ' + r.status);

// TEST 8 - Logout then protected API fails
r = await req('POST', '/api/auth/logout', null, userToken);
log('T8a Logout succeeds', r.status === 200, 'status ' + r.status);
r = await req('GET', '/api/user/profile', null, userToken);
log('T8b After logout protected API -> 401', r.status === 401, 'status ' + r.status);

// TEST 9 - Admin isolation
const adminLogin = await req('POST', '/api/auth/login', { username: 'admin', password: 'talora-admin' });
const adminToken = adminLogin.data && adminLogin.data.token;
log('T9a Admin login still works', adminLogin.status === 200 && !!adminToken, 'status ' + adminLogin.status);

r = await req('GET', '/api/website-settings', null, userToken);
log('T9b User token blocked from admin settings', r.status === 401 || r.status === 403, 'status ' + r.status);

r = await req('PUT', '/api/website-settings', { hero_title: 'HACKED' }, userToken);
log('T9c User token cannot modify settings', r.status === 401 || r.status === 403, 'status ' + r.status);

r = await req('DELETE', '/api/content/1', null, userToken);
log('T9d User token cannot delete content', r.status === 401 || r.status === 403, 'status ' + r.status);

r = await req('GET', '/api/website-settings', null, adminToken);
log('T9e Admin token still works', r.status === 200, 'status ' + r.status);

// Validation tests
r = await req('POST', '/api/auth/register', { fullName: '', email: 'bad', password: 'short', confirmPassword: 'nope' });
log('T10 Backend validation rejects bad input', r.status === 400, JSON.stringify(r.data).slice(0, 120));

const failed = results.filter(x => !x.pass);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
process.exit(failed.length ? 1 : 0);
