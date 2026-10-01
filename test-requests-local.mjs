// Quick check that the customer-request feature works on the LOCAL server too,
// and that the request inbox is ADMIN-only there as well.
const BASE = 'http://localhost:5501';
const out = [];
const log = (n, p, d) => { out.push(p); console.log((p ? 'PASS' : 'FAIL') + ' - ' + n + (d ? ' :: ' + d : '')); };
async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}
(async () => {
  // Unique email: requests-core rejects genuine duplicates (409), so re-runs must vary.
  const body = { fullName: 'Local Tester', email: `local-req-${Date.now()}@test.dev`, category: 'Web Development', title: 'Local enquiry', description: 'Please get in touch.' };
  let r = await req('POST', '/api/requests', body);
  log('local public POST /api/requests -> 201', r.status === 201, r.status + ' ' + JSON.stringify(r.data).slice(0, 60));

  r = await req('GET', '/api/requests');
  log('local unauthenticated GET /api/requests -> 401', r.status === 401, String(r.status));

  const a = await req('POST', '/api/auth/login', { username: 'admin', password: 'talora-admin' });
  r = await req('GET', '/api/requests', null, a.data.token);
  log('local ADMIN GET /api/requests -> 200', r.status === 200, String(r.status));

  const li = await req('POST', '/api/auth/user-login', { email: 'employee@talora.dev', password: 'TaloraEmployee!2024' });
  r = await req('GET', '/api/requests', null, li.data.token);
  log('local EMPLOYEE GET /api/requests -> 403', r.status === 403, String(r.status));

  r = await req('GET', '/api/requests', null, a.data.token);
  const id = r.data && r.data.items && r.data.items[0] && r.data.items[0].id;
  r = await req('PATCH', `/api/requests/${id}/status`, { status: 'IN_PROGRESS' }, a.data.token);
  log('local ADMIN PATCH request status -> 200', r.status === 200, String(r.status) + ' ' + JSON.stringify(r.data).slice(0, 80));
  r = await req('PATCH', `/api/requests/${id}/status`, { status: 'IN_PROGRESS' }, li.data.token);
  log('local EMPLOYEE PATCH request status -> 403', r.status === 403, String(r.status));

  const failed = out.filter(x => !x).length;
  console.log(`\n===== ${out.length - failed}/${out.length} passed =====`);
  process.exit(failed ? 1 : 0);
})();
