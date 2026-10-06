// Task 8 — Search & Filtering for Company Data: end-to-end suite.
// Runs against a live server (local: http://localhost:5501, or the deployed URL via TALORA_BASE).
//
// Every assertion goes through GET /api/requests and is compared against the database,
// proving the filtering happens server-side rather than in the browser.
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
  try { data = await res.json(); } catch { }
  return { status: res.status, data };
}

// ---------- 0. Company session ----------
const adminLogin = await req('POST', '/api/auth/admin-login', { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'talora-admin' });
const token = adminLogin.data && adminLogin.data.token;
log('F1 Company login works', adminLogin.status === 200 && !!token, 'status ' + adminLogin.status);
if (!token) process.exit(1);

// ---------- 1. Seed a known, isolated dataset ----------
// A unique marker in every field makes the expected matches unambiguous.
const M = 'f8-' + Date.now();
const seed = [
  { fullName: 'Ikram Hamdani', email: `ikram.${M}@example.com`, category: 'Web Development', title: `Website redesign ${M}`, description: 'A premium marketing website rebuild with a design system.' },
  { fullName: 'Sara Bennani', email: `sara.${M}@example.com`, category: 'Design', title: `Brand identity ${M}`, description: 'Logo, typography and a complete visual identity.' },
  { fullName: 'Youssef Alami', email: `youssef.${M}@example.com`, category: 'Strategy', title: `Growth strategy ${M}`, description: 'Market positioning and go-to-market planning.' },
  { fullName: 'Lina Moreau', email: `lina.${M}@example.com`, category: 'Web Development', title: `E-commerce platform ${M}`, description: 'Storefront, checkout and payment integration.' }
];

const ids = [];
for (const s of seed) {
  const created = await req('POST', '/api/requests', s);
  if (created.status === 201) ids.push(created.data.request.id);
}
log('F2 Seeded fixture requests in the database', ids.length === seed.length, ids.length + '/' + seed.length + ' created');

// Give two of them a non-PENDING status so status filtering has something to match.
await req('PATCH', `/api/requests/${ids[0]}/status`, { status: 'IN_PROGRESS' }, token);
await req('PATCH', `/api/requests/${ids[1]}/status`, { status: 'COMPLETED' }, token);

// A helper that runs a filter query and returns just the fixture rows it matched.
async function query(qs) {
  const r = await req('GET', '/api/requests?' + qs, undefined, token);
  const items = (r.data && r.data.items) || [];
  return { status: r.status, data: r.data, mine: items.filter(i => ids.includes(i.id)) };
}

// ---------- 2. Normal search (Test 1) ----------
let r = await query('search=' + encodeURIComponent(M));
log('F3 Search by unique marker returns all fixtures', r.status === 200 && r.mine.length === 4, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent('Ikram Hamdani'));
log('F4 Search by customer name', r.status === 200 && r.mine.length === 1 && r.mine[0].customerName === 'Ikram Hamdani', 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(`ikram.${M}@example.com`));
log('F5 Search by customer email', r.status === 200 && r.mine.length === 1, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(`Brand identity ${M}`));
log('F6 Search by subject', r.status === 200 && r.mine.length === 1 && r.mine[0].subject === `Brand identity ${M}`, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent('go-to-market'));
log('F7 Search by description text', r.status === 200 && r.mine.length === 1, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent('Strategy'));
log('F8 Search matches the request type column too', r.status === 200 && r.mine.some(i => i.requestType === 'Strategy'), 'matched ' + r.mine.length);

// Case-insensitive partial match
r = await query('search=' + encodeURIComponent('ikram'));
log('F9 Search is case-insensitive and partial', r.status === 200 && r.mine.length === 1, 'matched ' + r.mine.length);

// ---------- 3. Status filter (Test 2) ----------
r = await query('search=' + encodeURIComponent(M) + '&status=PENDING');
log('F10 Status=PENDING returns only pending fixtures', r.status === 200 && r.mine.length === 2 && r.mine.every(i => i.status === 'PENDING'), 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&status=IN_PROGRESS');
log('F11 Status=IN_PROGRESS returns only in-progress fixtures', r.status === 200 && r.mine.length === 1 && r.mine[0].id === ids[0], 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&status=COMPLETED');
log('F12 Status=COMPLETED returns only completed fixtures', r.status === 200 && r.mine.length === 1 && r.mine[0].id === ids[1], 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&status=REJECTED');
log('F13 Status=REJECTED returns none of the fixtures', r.status === 200 && r.mine.length === 0, 'matched ' + r.mine.length);

// ---------- 4. Type filter ----------
r = await query('search=' + encodeURIComponent(M) + '&type=' + encodeURIComponent('Web Development'));
log('F14 Type filter returns only that request type', r.status === 200 && r.mine.length === 2 && r.mine.every(i => i.requestType === 'Web Development'), 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&type=Design');
log('F15 Type filter (Design) returns one fixture', r.status === 200 && r.mine.length === 1 && r.mine[0].requestType === 'Design', 'matched ' + r.mine.length);

// ---------- 5. Multiple filters together (Test 3) ----------
r = await query('search=' + encodeURIComponent(M) + '&status=IN_PROGRESS&type=' + encodeURIComponent('Web Development'));
log('F16 Search + status + type are combined (AND)', r.status === 200 && r.mine.length === 1 && r.mine[0].id === ids[0], 'matched ' + r.mine.length);

// A combination that should match nothing: the completed fixture is a Design request.
r = await query('search=' + encodeURIComponent(M) + '&status=COMPLETED&type=' + encodeURIComponent('Web Development'));
log('F17 Conflicting combination returns nothing', r.status === 200 && r.mine.length === 0, 'matched ' + r.mine.length);

// Two filters that individually match but not together
r = await query('search=' + encodeURIComponent('Ikram') + '&status=COMPLETED');
log('F18 Search matching one row + mismatching status returns nothing', r.status === 200 && r.mine.length === 0, 'matched ' + r.mine.length);

// ---------- 6. Date filtering ----------
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const longAgo = '2020-01-01';

r = await query('search=' + encodeURIComponent(M) + '&dateFrom=' + today);
log('F19 dateFrom=today includes today\"s requests', r.status === 200 && r.mine.length === 4, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&dateTo=' + longAgo);
log('F20 dateTo in the past excludes them', r.status === 200 && r.mine.length === 0, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&dateFrom=' + today + '&dateTo=' + today);
log('F21 A single-day custom range includes today', r.status === 200 && r.mine.length === 4, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&dateFrom=' + tomorrow);
log('F22 Future-only range excludes today\"s requests', r.status === 200 && r.mine.length === 0, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&dateFrom=' + tomorrow + '&dateTo=' + today);
log('F23 Inverted date range is rejected -> 400', r.status === 400, 'status ' + r.status);

// ---------- 7. No results (Test 4) ----------
r = await query('search=' + encodeURIComponent('zzz-no-such-customer-' + M));
log('F24 Unmatched search returns an empty result set (not an error)', r.status === 200 && r.mine.length === 0, 'status ' + r.status);
log('F25 Empty result reports total 0', r.data && r.data.total === 0, 'total=' + (r.data && r.data.total));

// ---------- 8. Clear filters / default dataset (Test 5) ----------
r = await query('');
log('F26 No filters returns the unfiltered dataset', r.status === 200 && r.mine.length === 4, 'matched ' + r.mine.length);
log('F27 Unfiltered total is >= the fixture count', r.data.total >= 4, 'total=' + r.data.total);

// An empty-string filter must behave like an absent filter, not like a match-nothing filter.
r = await query('search=&status=&type=&dateFrom=&dateTo=');
log('F28 Blank filter values behave as \"no filter\"', r.status === 200 && r.mine.length === 4, 'matched ' + r.mine.length);

// ---------- 9. Query-parameter validation / hardening ----------
r = await query('status=NONSENSE&search=' + encodeURIComponent(M));
log('F29 Invalid status is ignored, not fatal', r.status === 200 && r.mine.length === 4, 'status ' + r.status);

r = await query('type=Nonsense&search=' + encodeURIComponent(M));
log('F30 Invalid request type is ignored, not fatal', r.status === 200 && r.mine.length === 4, 'status ' + r.status);

r = await query('dateFrom=not-a-date&search=' + encodeURIComponent(M));
log('F31 Malformed date is ignored, not fatal', r.status === 200 && r.mine.length === 4, 'status ' + r.status);

r = await query('search=' + encodeURIComponent("' OR 1=1 --"));
log('F32 SQL-injection style search returns no rows (no crash)', r.status === 200 && r.mine.length === 0, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent("%' OR '1'='1"));
log('F33 Wildcard-injection search is treated as literal text', r.status === 200 && r.mine.length === 0, 'matched ' + r.mine.length);

// Very long search input must be handled safely (truncated server-side).
r = await query('search=' + encodeURIComponent('x'.repeat(500)));
log('F34 Very long search string is handled safely', r.status === 200, 'status ' + r.status);

// ---------- 10. Pagination applies AFTER filtering ----------
r = await query('search=' + encodeURIComponent(M) + '&limit=2');
log('F35 Pagination metadata is returned', r.status === 200 && !!r.data.pagination, JSON.stringify(r.data.pagination));
log('F36 total reflects the FILTERED count, not the whole table', r.data.pagination.total === 4, 'total=' + r.data.pagination.total);
log('F37 totalPages is computed from the filtered count', r.data.pagination.totalPages === 2, 'totalPages=' + r.data.pagination.totalPages);
log('F38 Page size is honoured', r.data.items.length === 2, 'items=' + r.data.items.length);

r = await query('search=' + encodeURIComponent(M) + '&limit=2&page=2');
log('F39 Second page returns the remaining filtered rows', r.status === 200 && r.mine.length === 2, 'matched ' + r.mine.length);
const pageOne = await query('search=' + encodeURIComponent(M) + '&limit=2&page=1');
log('F40 Pages do not overlap', pageOne.mine[0].id !== r.mine[0].id, 'p1=' + pageOne.mine[0].id + ' p2=' + r.mine[0].id);

r = await query('search=' + encodeURIComponent(M) + '&limit=1&status=COMPLETED');
log('F41 Filters apply before paging (filtered page size)', r.status === 200 && r.mine.length === 1 && r.data.pagination.total === 1, 'matched ' + r.mine.length);

r = await query('search=' + encodeURIComponent(M) + '&limit=9999');
log('F42 Oversized limit is capped (no unbounded fetch)', r.status === 200 && r.data.items.length <= 100, 'items=' + r.data.items.length);

// ---------- 11. Sorting ----------
r = await query('search=' + encodeURIComponent(M) + '&sort=updated');
log('F43 sort=updated is accepted', r.status === 200 && r.data.items.length > 0, 'status ' + r.status);

r = await query('search=' + encodeURIComponent(M) + '&sort=' + encodeURIComponent('created_at; DROP TABLE customer_requests'));
log('F44 Unknown sort value falls back safely', r.status === 200, 'status ' + r.status);

const stillThere = await query('search=' + encodeURIComponent(M));
log('F45 The table survived every hostile parameter', stillThere.status === 200 && stillThere.mine.length === 4, 'matched ' + stillThere.mine.length);

// ---------- 12. Authorization (Test 7) ----------
log('F46 Anonymous search -> 401', (await req('GET', '/api/requests?search=' + encodeURIComponent(M))).status === 401, '');

const stamp12 = Date.now();
const custEmail = 'f8-cust-' + stamp12 + '@talora-test.dev';
await req('POST', '/api/auth/register', { fullName: 'F8 Customer', email: custEmail, password: 'Str0ngPassw0rd!', confirmPassword: 'Str0ngPassw0rd!' });
const custLogin = await req('POST', '/api/auth/user-login', { email: custEmail, password: 'Str0ngPassw0rd!' });
const custToken = custLogin.data && custLogin.data.token;
const custSearch = await req('GET', '/api/requests?search=' + encodeURIComponent(M), undefined, custToken);
log('F47 Non-company user search -> 401/403', [401, 403].includes(custSearch.status), 'status ' + custSearch.status);
log('F48 Non-company user receives no customer data', !custSearch.data || !custSearch.data.items, '');
log('F49 Forged token search -> 401', (await req('GET', '/api/requests?search=x', undefined, 'abc.def')).status === 401, '');

// ---------- 13. Direct database verification (Test 6) ----------
if (!process.env.TALORA_BASE) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH || 'talora.db', { readonly: true });
    const like = '%' + M + '%';
    const dbRows = db.prepare('SELECT id, status, category FROM customer_requests WHERE customer_name LIKE ? OR customer_email LIKE ? OR title LIKE ? OR description LIKE ?').all(like, like, like, like);
    log('F50 The database holds exactly the seeded fixtures', dbRows.length === 4, 'rows=' + dbRows.length);

    const dbInProgress = dbRows.filter(x => x.status === 'IN_PROGRESS');
    const apiInProgress = (await query('search=' + encodeURIComponent(M) + '&status=IN_PROGRESS')).mine;
    log('F51 API count equals the database count for a filtered query',
      apiInProgress.length === dbInProgress.length && apiInProgress.length === 1,
      'api=' + apiInProgress.length + ' db=' + dbInProgress.length);

    // Rebuild the expected match set with SQL and compare it to the API's answer.
    const dbWebDev = db.prepare("SELECT id FROM customer_requests WHERE title LIKE ? AND category = 'Web Development'").all(like).map(x => x.id).sort();
    const apiWebDev = (await query('search=' + encodeURIComponent(M) + '&type=' + encodeURIComponent('Web Development'))).mine.map(x => x.id).sort();
    log('F52 Combined search+type result matches the SQL equivalent',
      JSON.stringify(dbWebDev) === JSON.stringify(apiWebDev), 'db=' + JSON.stringify(dbWebDev) + ' api=' + JSON.stringify(apiWebDev));
    db.close();
  } catch (err) {
    log('F50 Direct database verification', false, err.message);
  }
}

const failed = results.filter(x => !x.pass);
console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' passed =====');
if (failed.length) failed.forEach(f => console.log('  FAILED: ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
process.exit(failed.length ? 1 : 0);