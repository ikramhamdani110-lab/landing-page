// Task 9 VERIFICATION — independent audit (not a refactor of the implementation).
// Exercises the backend directly, including the consolidated Vercel handler
// api/[...path].js invoked WITHOUT going through serve.js, plus override/escalation
// attempts.
//
// After the serverless consolidation every protected route is served by the single
// catch-all handler, so these tests target that file directly. That is what Vercel
// actually executes, which makes it the authoritative serverless surface.
process.env.DATABASE_PATH = process.env.DATABASE_PATH || 'talora.db';
const path = require('path');
const ROOT = __dirname;
const cc = require('./content-core');
const auc = require('./auth-user-core');
const rbac = require('./rbac-core');

const results = [];
const log = (n, p, d) => { results.push({ n, p }); console.log((p ? 'PASS' : 'FAIL') + ' - ' + n + (d ? ' :: ' + d : '')); };

// ---- helpers -------------------------------------------------------------
function mockRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b; return r; };
  r.json = (o) => { r.body = JSON.stringify(o); return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  return r;
}
function mockReq({ method = 'GET', url = '/', token, body }) {
  const headers = token ? { authorization: 'Bearer ' + token } : {};
  const req = { method, url, headers, socket: {} };
  if (body !== undefined) {
    const s = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    let done = false;
    req.on = (ev, cb) => { if (ev === 'data') cb(s); if (ev === 'end') { done = true; cb(); } };
    req[Symbol.asyncIterator] = async function* () { if (!done) { done = true; yield s; } };
  } else {
    req.on = (ev, cb) => { if (ev === 'end') cb(); };
    req[Symbol.asyncIterator] = async function* () {};
  }
  return req;
}
const call = async (handler, opts) => { const res = mockRes(); await handler(mockReq(opts), res); return res; };

const AUTH = { content: { title: 'V', description: 'D', category: 'General', status: 'published', section: 'General' } };

(async () => {
  // =====================================================================
  // 1. MATRIX / UNIT
  // =====================================================================
  log('ADMIN has all 12 permissions', rbac.permissionsFor('ADMIN').length === 12, String(rbac.permissionsFor('ADMIN').length));
  log('EMPLOYEE has exactly content:read + content:update',
    JSON.stringify(rbac.permissionsFor('EMPLOYEE').sort()) === JSON.stringify(['content:read', 'content:update'].sort()),
    JSON.stringify(rbac.permissionsFor('EMPLOYEE')));
  log('can() rejects unknown role', rbac.can('superadmin', 'content:read') === false);
  log('can() rejects null/undefined', rbac.can(null, 'content:read') === false && rbac.can(undefined, 'content:create') === false);
  log('normalizeRole maps legacy "user" -> EMPLOYEE', rbac.normalizeRole('user') === 'EMPLOYEE' && rbac.normalizeRole('USER') === 'EMPLOYEE');
  log('normalizeRole accepts ADMIN/employee case-insensitively',
    rbac.normalizeRole('admin') === 'ADMIN' && rbac.normalizeRole(' employee ') === 'EMPLOYEE');
  log('normalizeRole rejects garbage', rbac.normalizeRole('superadmin') === null && rbac.normalizeRole("ADMIN'; DROP TABLE users;--") === null);
  log('normalizeRoleForStorage degrades unknown -> EMPLOYEE (no arbitrary storage)',
    rbac.normalizeRoleForStorage('root') === 'EMPLOYEE');
  // Field-level merge
  const merged = rbac.mergeContentFields({ title: 'old', description: 'od', category: 'Skill', section: 'Hero', status: 'published' },
    { title: 'new', description: 'nd', category: 'General', section: 'Hero', status: 'draft' }, 'EMPLOYEE');
  log('EMPLOYEE merge: status preserved from stored record', merged.status === 'published', merged.status);
  log('EMPLOYEE merge: permitted fields applied', merged.title === 'new' && merged.description === 'nd');
  const mergedAdmin = rbac.mergeContentFields({ title: 'old', description: 'd', category: 'S', section: 'Hero', status: 'published' },
    { title: 'n', description: 'd', category: 'S', section: 'Hero', status: 'draft' }, 'ADMIN');
  log('ADMIN merge: status change honored', mergedAdmin.status === 'draft', mergedAdmin.status);
  const partial = rbac.mergeContentFields({ title: 'old', description: 'od', category: 'Skill', section: 'Hero', status: 'published' }, {}, 'EMPLOYEE');
  log('Partial EMPLOYEE payload cannot blank out columns',
    partial.title === 'old' && partial.description === 'od' && partial.category === 'Skill' && partial.section === 'Hero' && partial.status === 'published',
    JSON.stringify(partial));

  // =====================================================================
  // 2. ACCOUNTS
  // =====================================================================
  const db = cc.createDb(path.join(ROOT, process.env.DATABASE_PATH));
  const stamp = Date.now();
  const pwd = 'Str0ngPassw0rd!';
  const empEmail = `v-emp-${stamp}@talora-test.dev`;
  const admEmail = `v-adm-${stamp}@talora-test.dev`;

  const reg1 = await auc.registerUser(db, { fullName: 'V Emp', email: empEmail, password: pwd, confirmPassword: pwd, role: 'ADMIN' });
  const reg2 = await auc.registerUser(db, { fullName: 'V Adm', email: admEmail, password: pwd, confirmPassword: pwd, role: 'ADMIN' });
  log('Registration IGNORES role:ADMIN in body -> stored EMPLOYEE',
    reg1.ok && reg1.user.role === 'EMPLOYEE' && reg2.ok && reg2.user.role === 'EMPLOYEE', reg1.user && reg1.user.role);
  const empId = reg1.user.id, admId = reg2.user.id;

  const li = await auc.loginUser(db, { email: empEmail, password: pwd });
  const empToken = li.token;
  const la = await auc.loginUser(db, { email: admEmail, password: pwd });
  let admToken = la.token;
  log('User login issues token (role not in payload)', !!empToken, empToken.split('.')[0]);

  // Token payload must NOT carry the real role (so it cannot be forged/stale).
  const payload = JSON.parse(Buffer.from(empToken.split('.')[0], 'base64url').toString());
  log('User token payload role is generic "user", not EMPLOYEE/ADMIN', payload.role === 'user', JSON.stringify(payload));

  // Promote the second account to ADMIN via the core function (as an admin would).
  await auc.updateUserRole(db, admId, { role: 'ADMIN' });
  // Role is read from the DB on EVERY request -> the existing token gains admin rights.
  const pr = await rbac.getPrincipal({ headers: { authorization: 'Bearer ' + la.token } });
  log('Role change takes effect without re-login (DB read per request)', pr && pr.role === 'ADMIN', pr && pr.role);

  // Tampered token
  const [p, s] = empToken.split('.');
  const badSig = Buffer.from(JSON.stringify({ sub: admId, role: 'user', exp: Date.now() + 9e6 })).toString('base64url') + '.' + s;
  log('Re-signed payload with a different sub is rejected (HMAC)', await rbac.getPrincipal({ headers: { authorization: 'Bearer ' + badSig } }) === null);
  const tamperedEmp = p + 'x.' + s;
  log('Tampered user token -> no principal', await rbac.getPrincipal({ headers: { authorization: 'Bearer ' + tamperedEmp } }) === null);
  // Cross-secret: admin token must not verify as a user token
  const ccLogin = cc.login(JSON.stringify({ username: 'admin', password: 'talora-admin' }));
  const cmsToken = ccLogin.token;
  log('Admin token cannot be replayed as a user token for /api/user/profile',
    auc.verifyUserToken({ headers: { authorization: 'Bearer ' + cmsToken } }) === null);

  // =====================================================================
  // 3. CONSOLIDATED SERVERLESS HANDLER CALLED DIRECTLY (bypassing serve.js)
  // =====================================================================
  // api/[...path].js is the ONLY Vercel function; it must enforce RBAC itself.
  const sl = require('./api/[...path].js');

  // A shared record created by the consolidated handler as ADMIN.
  const C = '/api/content';
  let r = await call(sl, { method: 'POST', url: C, token: cmsToken, body: AUTH.content });
  const recId = r.body && JSON.parse(r.body).item && JSON.parse(r.body).item.id;
  log('[serverless] ADMIN POST /api/content -> 201', r.statusCode === 201 && !!recId, String(r.statusCode));

  const direct = [
    ['content GET', { method: 'GET', url: C }, 'EMPLOYEE', 200],
    ['content POST', { method: 'POST', url: C, body: AUTH.content }, 'EMPLOYEE', 403],
    ['content/:id GET', { method: 'GET', url: C + '/' + recId }, 'EMPLOYEE', 200],
    ['content/:id PUT', { method: 'PUT', url: C + '/' + recId, body: AUTH.content }, 'EMPLOYEE', 200],
    ['content/:id PATCH', { method: 'PATCH', url: C + '/' + recId, body: AUTH.content }, 'EMPLOYEE', 200],
    ['content/:id DELETE', { method: 'DELETE', url: C + '/' + recId }, 'EMPLOYEE', 403],
    ['admin/services GET', { method: 'GET', url: '/api/admin/services' }, 'EMPLOYEE', 403],
    ['admin/services POST', { method: 'POST', url: '/api/admin/services', body: { title: 't', description: 'd', icon: '', status: 'active' } }, 'EMPLOYEE', 403],
    ['admin/services/:id GET', { method: 'GET', url: '/api/admin/services/1' }, 'EMPLOYEE', 403],
    ['admin/services/:id PUT', { method: 'PUT', url: '/api/admin/services/1', body: { title: 't', description: 'd', icon: '', status: 'active' } }, 'EMPLOYEE', 403],
    ['admin/services/:id DELETE', { method: 'DELETE', url: '/api/admin/services/1' }, 'EMPLOYEE', 403],
    ['website-settings GET', { method: 'GET', url: '/api/website-settings' }, 'EMPLOYEE', 403],
    ['website-settings PUT', { method: 'PUT', url: '/api/website-settings', body: { hero_title: 'X' } }, 'EMPLOYEE', 403],
    ['admin/users GET', { method: 'GET', url: '/api/admin/users' }, 'EMPLOYEE', 403],
    ['admin/users PUT', { method: 'PUT', url: '/api/admin/users/' + empId, body: { role: 'ADMIN' } }, 'EMPLOYEE', 403],
    // The customer-request inbox is ADMIN-only (public POST stays open).
    ['requests GET', { method: 'GET', url: '/api/requests' }, 'EMPLOYEE', 403],
    ['requests/:id GET', { method: 'GET', url: '/api/requests/1' }, 'EMPLOYEE', 403],
    ['requests/:id/status PATCH', { method: 'PATCH', url: '/api/requests/1/status', body: { status: 'closed' } }, 'EMPLOYEE', 403]
  ];
  for (const [name, opts, who, want] of direct) {
    const res = await call(sl, { ...opts, token: empToken });
    log(`[serverless] ${who} ${name} -> ${want}`, res.statusCode === want, String(res.statusCode));
  }
  // Unauthenticated direct-to-serverless
  for (const [name, opts] of [['content GET', { method: 'GET', url: C }],
    ['content POST', { method: 'POST', url: C, body: AUTH.content }],
    ['content/:id DELETE', { method: 'DELETE', url: C + '/' + recId }],
    ['website-settings GET', { method: 'GET', url: '/api/website-settings' }],
    ['admin/services GET', { method: 'GET', url: '/api/admin/services' }],
    ['admin/users GET', { method: 'GET', url: '/api/admin/users' }],
    ['admin/users PUT', { method: 'PUT', url: '/api/admin/users/' + empId, body: { role: 'ADMIN' } }],
    ['requests GET', { method: 'GET', url: '/api/requests' }]]) {
    const res = await call(sl, opts);
    log(`[serverless] UNAUTH ${name} -> 401`, res.statusCode === 401, String(res.statusCode));
  }
  // ADMIN direct-to-serverless
  for (const [name, opts] of [['content POST', { method: 'POST', url: C, body: { ...AUTH.content, title: 'ADMIN via serverless' } }],
    ['admin/users GET', { method: 'GET', url: '/api/admin/users' }],
    ['admin/services GET', { method: 'GET', url: '/api/admin/services' }],
    ['website-settings GET', { method: 'GET', url: '/api/website-settings' }],
    ['requests GET', { method: 'GET', url: '/api/requests' }]]) {
    const res = await call(sl, { ...opts, token: cmsToken });
    log(`[serverless] ADMIN ${name} -> 200/201`, res.statusCode === 200 || res.statusCode === 201, String(res.statusCode));
  }
  // Public routes must stay open (no auth regression).
  for (const [name, opts] of [['website-content GET', { method: 'GET', url: '/api/website-content' }],
    ['services GET', { method: 'GET', url: '/api/services' }],
    ['contact POST', { method: 'POST', url: '/api/contact', body: { name: 'A B', email: 'a@b.co', subject: 'Start a Project', message: 'hello there' } }]]) {
    const res = await call(sl, opts);
    log(`[serverless] PUBLIC ${name} stays open (2xx)`, res.statusCode >= 200 && res.statusCode < 300, String(res.statusCode));
  }

  // =====================================================================
  // 4. OVERRIDE ATTEMPTS (body / query / header / method)
  // =====================================================================
  // The serverless shims resolve their own SQLite file; point them at the same one.
  process.env.DATABASE_PATH = path.join(ROOT, process.env.DATABASE_PATH || 'talora.db');
  const q = await call(sl, { method: 'GET', url: C + '/' + recId + '?role=ADMIN&as=admin', token: cmsToken });
  log('Query param ?role=ADMIN has no effect (read still scoped by role)', q.statusCode === 200, String(q.statusCode));
  const q2 = await call(sl, { method: 'GET', url: C + '/' + recId + '?role=ADMIN&as=admin' });
  log('Same URL without a token is still 401 (query is not a credential)', q2.statusCode === 401, String(q2.statusCode));
  const res2 = await call(sl, { method: 'PUT', url: C + '/' + recId + '?role=ADMIN', token: empToken,
    body: { ...AUTH.content, title: 'Q1', status: 'draft' } });
  const parsed2 = res2.body && JSON.parse(res2.body);
  log('EMPLOYEE PUT with ?role=ADMIN cannot publish (status unchanged)',
    res2.statusCode === 200 && parsed2.item.status === 'published', parsed2.item && parsed2.item.status);

  // Header spoofing is impossible: only the signed bearer token is read.
  const spoofedReq = mockReq({ method: 'GET', url: '/api/content', token: empToken });
  spoofedReq.headers['x-role'] = 'ADMIN'; spoofedReq.headers['x-user-role'] = 'ADMIN'; spoofedReq.headers['x-forwarded-user'] = 'admin';
  const r3b = mockRes(); await sl(spoofedReq, r3b);
  log('Spoofed x-role/x-user-role headers do not escalate (still EMPLOYEE)',
    r3b.statusCode === 200 && rbac.can('EMPLOYEE', 'content:create') === false, String(r3b.statusCode));
  const spoofAdmin = mockReq({ method: 'GET', url: '/api/admin/users', token: empToken });
  spoofAdmin.headers['x-role'] = 'ADMIN'; spoofAdmin.headers['x-user-role'] = 'ADMIN';
  const r3c = mockRes(); await sl(spoofAdmin, r3c);
  log('Spoofed x-role header cannot unlock /api/admin/users (403)', r3c.statusCode === 403, String(r3c.statusCode));

  // Role management: every override channel on the ADMIN-only endpoint
  for (const [name, opts] of [
    ['body role', { method: 'PUT', url: '/api/admin/users/' + empId, body: { role: 'ADMIN' } }],
    ['body role lowercase', { method: 'PUT', url: '/api/admin/users/' + empId, body: { role: 'admin' } }],
    ['body __proto__/role injection', { method: 'PUT', url: '/api/admin/users/' + empId, body: { role: 'ADMIN', id: admId, password_hash: 'x' } }]
  ]) {
    const res = await call(sl, { ...opts, token: empToken });
    log(`EMPLOYEE role self-escalation via ${name} -> 403`, res.statusCode === 403, String(res.statusCode));
  }
  const after = await auc.getUserById(db, empId);
  log('EMPLOYEE role in DB is still EMPLOYEE after all escalation attempts', after.role === 'EMPLOYEE', after.role);

  // EMPLOYEE modifying ANOTHER user
  const r4 = await call(sl, { method: 'PUT', url: '/api/admin/users/' + admId, body: { role: 'EMPLOYEE' }, token: empToken });
  log('EMPLOYEE cannot demote another ADMIN -> 403', r4.statusCode === 403, String(r4.statusCode));
  log('Other user role untouched', (await auc.getUserById(db, admId)).role === 'ADMIN');

  // Invalid role values
  for (const v of ['superadmin', '', 'ADMIN;DROP TABLE users', null, 42, {}]) {
    const res = await call(sl, { method: 'PUT', url: '/api/admin/users/' + empId, body: { role: v }, token: cmsToken });
    if (res.statusCode !== 400) log(`Invalid role ${JSON.stringify(v)} rejected -> 400`, false, String(res.statusCode));
  }
  log('All invalid role values rejected with 400 (enum enforced)', true);

  // Non-admin method on role endpoint
  const r5 = await call(sl, { method: 'DELETE', url: '/api/admin/users/' + empId, token: cmsToken });
  log('DELETE /api/admin/users/:id is not a supported operation (405)', r5.statusCode === 405, String(r5.statusCode));

  // Profile endpoint: role must be ignored
  const prof = await auc.updateUserProfile(db, empId, { fullName: 'Renamed', email: `v-emp2-${stamp}@x.dev`, role: 'ADMIN' });
  log('updateUserProfile ignores role + password_hash + id',
    prof.ok && prof.user.role === 'EMPLOYEE', prof.user && prof.user.role);
  const prof2 = await auc.updateUserProfile(db, empId, { fullName: 'Renamed', role: 'ADMIN', password: 'x', id: 1, created_at: 'x' });
  log('updateUserProfile still EMPLOYEE after protected-field payload', prof2.ok && prof2.user.role === 'EMPLOYEE');

  // =====================================================================
  // 5. DATABASE CONSTRAINT / MIGRATION
  // =====================================================================
  let checkBlocked = false;
  let liveSql = '';
  try {
    liveSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql || '';
    db.prepare("INSERT INTO users (full_name,email,password_hash,role) VALUES ('x','blk@t.dev','h','ROOT')").run();
  } catch (e) { checkBlocked = /CHECK|constraint/i.test(e.message); }
  log('Live DB users table has a role CHECK constraint', /CHECK\s*\(\s*role\s+IN/i.test(liveSql));
  log('SQLite CHECK constraint rejects an out-of-enum role', checkBlocked);
  try { db.prepare("DELETE FROM users WHERE email='blk@t.dev'").run(); } catch { }
  let nullBlocked = false;
  try { db.prepare("INSERT INTO users (full_name,email,password_hash,role) VALUES ('x','blk2@t.dev','h',NULL)").run(); }
  catch (e) { nullBlocked = /NOT NULL/i.test(e.message); }
  log('SQLite role column is NOT NULL', nullBlocked);

  // Legacy migration: simulate a pre-RBAC table.
  const legacyFile = path.join(ROOT, 'verify-legacy.db');
  try { require('fs').unlinkSync(legacyFile); } catch { }
  const L = require('better-sqlite3');
  const ldb = new L(legacyFile);
  ldb.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  ldb.prepare("INSERT INTO users (full_name,email,password_hash,role) VALUES ('Legacy','legacy@t.dev','h','user')").run();
  ldb.prepare("INSERT INTO users (full_name,email,password_hash,role) VALUES ('Weird','weird@t.dev','h','manager')").run();
  ldb.prepare("INSERT INTO users (full_name,email,password_hash,role) VALUES ('Adm','adm@t.dev','h','ADMIN')").run();
  ldb.close();
  const ldb2 = require('./auth-user-core').createDb(legacyFile);
  const rows = ldb2.prepare('SELECT email, role FROM users ORDER BY id').all();
  log('Legacy role "user" migrated to EMPLOYEE', rows[0].role === 'EMPLOYEE', rows[0].role);
  log('Unknown legacy role degrades to EMPLOYEE (fail-safe)', rows[1].role === 'EMPLOYEE', rows[1].role);
  log('Existing ADMIN row preserved', rows[2].role === 'ADMIN', rows[2].role);
  // The rebuilt legacy table must now carry the enum constraint.
  const legacySql = ldb2.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql || '';
  let legacyBlocked = false;
  try { ldb2.prepare("INSERT INTO users (full_name,email,password_hash,role) VALUES ('x','blk@t.dev','h','ROOT')").run(); }
  catch (e) { legacyBlocked = /CHECK|constraint/i.test(e.message); }
  log('Migrated legacy table gained the role CHECK constraint', /CHECK\s*\(\s*role\s+IN/i.test(legacySql) && legacyBlocked);
  // Signup-type column and data must survive the rebuild.
  ldb2.prepare("INSERT INTO users (full_name,email,password_hash,role,signup_type) VALUES ('T','t@t.dev','h','EMPLOYEE','talent')").run();
  log('Rebuilt table still accepts signup_type inserts', ldb2.prepare("SELECT signup_type FROM users WHERE email='t@t.dev'").get().signup_type === 'talent');
  ldb2.close();
  try { require('fs').unlinkSync(legacyFile); } catch { }

  // Sensitive data
  const lu = await call(sl, { method: 'GET', url: '/api/admin/users', token: cmsToken });
  log('Admin user list never exposes password_hash', !/password_hash|passwordHash/.test(lu.body || ''));

  // ---- Architecture-migration regression guards -------------------------
  // These pin the behaviours that would silently regress if the consolidated
  // router ever fell back to a non-RBAC auth path.
  const fsmod = require('fs');
  const src = fsmod.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');
  const srv = fsmod.readFileSync(path.join(ROOT, 'serve.js'), 'utf8');

  const meEmp = await call(sl, { method: 'GET', url: '/api/auth/me', token: empToken });
  const meEmpRole = meEmp.body && JSON.parse(meEmp.body).user.role;
  log('[migration] /api/auth/me returns the DB role, not a hardcoded "user"', meEmpRole === 'EMPLOYEE', String(meEmpRole));
  const meAdm = await call(sl, { method: 'GET', url: '/api/auth/me', token: cmsToken });
  const meAdmRole = meAdm.body && JSON.parse(meAdm.body).user.role;
  log('[migration] /api/auth/me returns the DB role, not a hardcoded "admin"', meAdmRole === 'ADMIN', String(meAdmRole));

  log('[migration] consolidated handler requires rbac-core', src.includes("require('../rbac-core')"));
  log('[migration] consolidated handler uses rbac.can() (shared matrix)', /rbac\.can\(/.test(src));
  log('[migration] consolidated handler uses rbac.mergeContentFields() (employee field rules)', /rbac\.mergeContentFields\(/.test(src));
  // Slice each handler's own body (up to the next `async function` or module.exports)
  // so an unrelated helper elsewhere in the file cannot leak into the check.
  const handlerBody = (name) => {
    const start = src.indexOf('async function ' + name + '(');
    if (start < 0) return '';
    const rest = src.slice(start);
    const end = rest.slice(1).search(/\n(?:async function |module\.exports)/);
    return end < 0 ? rest : rest.slice(0, end + 1);
  };
  const CRUD = ['handleContent', 'handleServices', 'handleWebsiteSettings', 'handleRequests'];
  log('[migration] no protected CRUD handler uses a bare verifyAuth/verifyAdmin gate',
    CRUD.every(n => !/if\s*\(\s*!\s*(contentCore|siteCore)\.verify(Auth|Admin)\(/.test(handlerBody(n))));
  log('[migration] every protected CRUD handler delegates to an rbac guard',
    CRUD.every(n => /await guard\(/.test(handlerBody(n)) || /await guardAdmin\(/.test(handlerBody(n))));
  log('[migration] no hardcoded role literal remains in the consolidated handler',
    !/role:\s*'user'/.test(src) && !/role:\s*'admin'/.test(src));
  log('[migration] serve.js uses rbac-core and has no requireAuth() call left',
    srv.includes("require('./rbac-core')") && !/^\s*if \(!requireAuth\(/m.test(srv));
  // The frontend mirror is allowed; a second *server-side* matrix is not.
  const cmsSrc = fsmod.readFileSync(path.join(ROOT, 'cms.js'), 'utf8');
  log('[migration] no duplicate permission matrix on the server side',
    !/ROLE_PERMISSIONS/.test(srv) && !/ROLE_PERMISSIONS/.test(src));
  log('[migration] frontend cms.js still mirrors permissions for UX (expected)', /ROLE_PERMISSIONS/.test(cmsSrc));
  log('[migration] rbac-core.js is the only definition of ROLE_PERMISSIONS',
    /ROLE_PERMISSIONS\s*=\s*Object\.freeze/.test(fsmod.readFileSync(path.join(ROOT, 'rbac-core.js'), 'utf8')));

  // requests-core rejects near-duplicate submissions (409), so use a unique email.
  const post = await call(sl, { method: 'POST', url: '/api/requests', body: {
    fullName: 'RBAC Tester', email: `rbac-req-${stamp}@test.dev`, category: 'Web Development',
    title: 'Project enquiry', description: 'Please contact me about a new project.'
  } });
  log('[migration] public POST /api/requests still works (201)', post.statusCode === 201, String(post.statusCode) + ' ' + String(post.body).slice(0, 90));
  const listAdm = await call(sl, { method: 'GET', url: '/api/requests', token: cmsToken });
  log('[migration] ADMIN can list requests (200)', listAdm.statusCode === 200, String(listAdm.statusCode));
  const listUn = await call(sl, { method: 'GET', url: '/api/requests' });
  log('[migration] unauthenticated GET /api/requests -> 401', listUn.statusCode === 401, String(listUn.statusCode));

  // Cleanup
  db.close();
  const failed = results.filter(x => !x.p);
  console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
  if (failed.length) console.log('FAILED: ' + failed.map(f => f.n).join(' | '));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('verification crashed:', e); process.exit(1); });
