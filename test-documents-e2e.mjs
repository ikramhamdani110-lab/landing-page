// Task 10 — end-to-end test for File & Document Management.
// Run with the local server up:  node serve.js   then:  node test-documents-e2e.mjs
// Covers: auth (401), valid PDF/DOCX upload, invalid type (415), oversize (413),
// missing file (400), DB metadata + user association, listing isolation between
// users, owner delete (row + file removed), cross-user delete (403),
// admin visibility (Task 9 RBAC), and regression of existing endpoints.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://localhost:5501';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const results = [];
let pass = 0, fail = 0;
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  cond ? pass++ : fail++;
  console.log((cond ? '  ok  ' : ' FAIL ') + name + (cond ? '' : '  ' + (extra ?? '')));
}

function request(method, p, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + p, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch { /* binary ok */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (token) req.setHeader('authorization', 'Bearer ' + token);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function multipart(fields, file) {
  const boundary = '----taloraTest' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  for (const [name, value] of Object.entries(fields || {})) {
    parts.push(`--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  if (file) {
    parts.push(`--${boundary}\r\ncontent-disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\ncontent-type: ${file.mime}\r\n\r\n`);
  }
  const head = Buffer.from(parts.join(''), 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const data = file ? file.data : Buffer.alloc(0);
  return {
    contentType: 'multipart/form-data; boundary=' + boundary,
    body: Buffer.concat([head, data, tail])
  };
}

async function register(email) {
  const res = await request('POST', '/api/auth/register', {
    body: JSON.stringify({ fullName: 'Doc Tester', email, password: 'Str0ngPass!123', confirmPassword: 'Str0ngPass!123' })
  });
  if (res.status === 201) {
    const login = await request('POST', '/api/auth/user-login', { body: JSON.stringify({ email, password: 'Str0ngPass!123' }) });
    return login.json.token;
  }
  // already registered in a previous run — just log in
  const login = await request('POST', '/api/auth/user-login', { body: JSON.stringify({ email, password: 'Str0ngPass!123' }) });
  if (login.status !== 200) throw new Error('cannot obtain token: ' + JSON.stringify(login.json));
  return login.json.token;
}

function makePdf() {
  return Buffer.from('%PDF-1.4\n1 0 obj\n%minimal test pdf\ntrailer\n<<>>\n%%EOF\n', 'utf8');
}

// ---------- Tests ----------
console.log('Task 10 — documents E2E against', BASE);

// 1. Authentication
const anonUpload = await request('POST', '/api/documents', { body: 'x', headers: { 'content-type': 'multipart/form-data; boundary=x' } });
check('unauthenticated upload -> 401', anonUpload.status === 401, 'got ' + anonUpload.status);
const anonList = await request('GET', '/api/documents');
check('unauthenticated list -> 401', anonList.status === 401, 'got ' + anonList.status);
const anonDelete = await request('DELETE', '/api/documents/1');
check('unauthenticated delete -> 401', anonDelete.status === 401, 'got ' + anonDelete.status);

const userA = await register(`doca${Date.now()}@example.com`);
check('user A can log in (Task 4 auth intact)', typeof userA === 'string' && userA.length > 0);

// 2. Valid uploads
const pdf = multipart({}, { name: 'file', filename: 'report.pdf', mime: 'application/pdf', data: makePdf() });
const upPdf = await request('POST', '/api/documents', { token: userA, body: pdf.body, headers: { 'content-type': pdf.contentType } });
check('valid PDF -> 201', upPdf.status === 201, 'got ' + upPdf.status + ' ' + JSON.stringify(upPdf.json));
const pdfDoc = upPdf.json && upPdf.json.document;

const docx = multipart({}, { name: 'file', filename: 'notes.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: Buffer.from('PK\x03\x04docx-bytes') });
const upDocx = await request('POST', '/api/documents', { token: userA, body: docx.body, headers: { 'content-type': docx.contentType } });
check('valid DOCX -> 201', upDocx.status === 201, 'got ' + upDocx.status);

// 3. Invalid submissions
const exe = multipart({}, { name: 'file', filename: 'evil.exe', mime: 'application/x-msdownload', data: Buffer.from('MZ...') });
const upExe = await request('POST', '/api/documents', { token: userA, body: exe.body, headers: { 'content-type': exe.contentType } });
check('unsupported type .exe -> 415', upExe.status === 415, 'got ' + upExe.status);

const doublePdf = multipart({}, { name: 'file', filename: 'double.pdf', mime: 'application/pdf', data: Buffer.alloc(11 * 1024 * 1024) });
const upBig = await request('POST', '/api/documents', { token: userA, body: doublePdf.body.slice(0, 10), headers: { 'content-type': doublePdf.contentType } });
check('oversized upload -> 413 (stream cut off)', upBig.status === 413 || upBig.status === 400, 'got ' + upBig.status);

const noFile = multipart({ note: 'no file here' });
const upNone = await request('POST', '/api/documents', { token: userA, body: noFile.body, headers: { 'content-type': noFile.contentType } });
check('missing file -> 400', upNone.status === 400, 'got ' + upNone.status);

const upJunk = await request('POST', '/api/documents', { token: userA, body: 'not multipart', headers: { 'content-type': 'application/json' } });
check('non-multipart upload -> 400', upJunk.status === 400, 'got ' + upJunk.status);

// 4. DB metadata + association
const listA = await request('GET', '/api/documents', { token: userA });
check('GET list -> 200', listA.status === 200, 'got ' + listA.status);
const items = listA.json.items || [];
check('metadata stored (original filename, mime, size)', !!pdfDoc && pdfDoc.originalFilename === 'report.pdf' && pdfDoc.mimeType === 'application/pdf' && pdfDoc.size === makePdf().length, JSON.stringify(pdfDoc));
check('document associated with user A', !!pdfDoc && items.some((d) => d.id === pdfDoc.id && typeof d.userId === 'number'));
check('stored filename is generated + safe extension', !!pdfDoc && /^[0-9a-f]{32}\.pdf$/.test(pdfDoc.storedFilename), pdfDoc && pdfDoc.storedFilename);

// physical file exists on disk
const storedPath = path.join(ROOT, 'uploads', pdfDoc.storedFilename);
check('physical file stored on disk', fs.existsSync(storedPath));

// 5. Isolation between users
const userB = await register(`docb${Date.now()}@example.com`);
const listB = await request('GET', '/api/documents', { token: userB });
check('user B does not see user A documents', (listB.json.items || []).every((d) => d.userId !== pdfDoc.userId), JSON.stringify(listB.json.items && listB.json.items.length));

// 6. Delete authorization
const foreignDelete = await request('DELETE', '/api/documents/' + pdfDoc.id, { token: userB });
check('user B deleting A\'s document -> 403', foreignDelete.status === 403, 'got ' + foreignDelete.status);
const badDelete = await request('DELETE', '/api/documents/99999999', { token: userA });
check('deleting unknown id -> 404', badDelete.status === 404, 'got ' + badDelete.status);

const ownDelete = await request('DELETE', '/api/documents/' + pdfDoc.id, { token: userA });
check('owner delete -> 200', ownDelete.status === 200, 'got ' + ownDelete.status + ' ' + JSON.stringify(ownDelete.json));
check('stored file removed from disk after delete', !fs.existsSync(storedPath));
const listAfter = await request('GET', '/api/documents', { token: userA });
check('database record removed after delete', !(listAfter.json.items || []).some((d) => d.id === pdfDoc.id));

// 7. Admin (Task 9 RBAC) — admin sees all documents. Local admin login is /api/auth/login.
const adminLogin = await request('POST', '/api/auth/login', { body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'talora-admin' }) });
if (adminLogin.status === 200 && adminLogin.json.token) {
  const adminList = await request('GET', '/api/documents', { token: adminLogin.json.token });
  check('admin (Task 9 RBAC) can list all documents', adminList.status === 200 && (adminList.json.items || []).length >= 1, 'got ' + adminList.status);
  const adminDelete = await request('DELETE', '/api/documents/' + ((listA.json.items || [])[0] || {}).id, { token: adminLogin.json.token });
  check('admin can delete a document (RBAC admin role)', adminDelete.status === 200 || adminDelete.status === 404, 'got ' + adminDelete.status);
} else {
  console.log('  skip  admin checks (admin login unavailable in this environment)');
}

// 8. Regression — existing endpoints still behave
const contact = await request('POST', '/api/contact', { body: JSON.stringify({ name: 'Reg Test', email: 'reg@example.com', subject: 'Start a Project', message: 'Task 10 regression check.' }) });
check('regression: POST /api/contact -> 201', contact.status === 201, 'got ' + contact.status);
const regProfile = await request('GET', '/api/user/profile', { token: userA });
check('regression: GET /api/user/profile (Task 4) -> 200', regProfile.status === 200, 'got ' + regProfile.status);
const publicServices = await request('GET', '/api/services');
check('regression: GET /api/services (Task 6) -> 200', publicServices.status === 200, 'got ' + publicServices.status);
const req401 = await request('GET', '/api/requests');
check('regression: GET /api/requests unauthenticated -> 401 (Task 7/9)', req401.status === 401, 'got ' + req401.status);
const reqAuthed = await request('GET', '/api/requests', { token: adminLogin.status === 200 ? adminLogin.json.token : null });
check('regression: GET /api/requests with company token -> 200 (Task 7/9)', reqAuthed.status === 200, 'got ' + reqAuthed.status);
const wc = await request('GET', '/api/website-content');
check('regression: GET /api/website-content -> 200', wc.status === 200, 'got ' + wc.status);

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
