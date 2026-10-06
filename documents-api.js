// Task 10 — shared handler for the /api/documents endpoints.
// Used by both serve.js (local Node server) and api/[...path].js (Vercel serverless),
// exactly like auth-user-api.js. Every DB/storage touch goes through documents-core.js.
//
// Endpoints:
//   POST   /api/documents   — multipart upload (authenticated)
//   GET    /api/documents   — list the caller's documents (authenticated; admin sees all)
//   DELETE /api/documents/:id — delete own document (admin may delete any)
//
// Authentication reuses the existing systems ONLY:
//   - a signed-in customer/employee: the Task 4 user bearer token (auth-user-core)
//   - a company/admin session: the Task 9 admin token (requests-core.verifyAdminToken)
// There is no separate document login, session or role mechanism.

const fs = require('fs');
const rbac = require('./rbac-core');
const dc = require('./documents-core');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

// Resolve the authenticated principal through the Task 9 RBAC layer — the SAME
// role enum, permission matrix and guards used by every other protected route.
// kind 'admin' — existing TALORA company/admin token (ADMIN role, full document access)
// kind 'user'  — Task 4 user bearer token (EMPLOYEE role: manages own documents)
async function resolvePrincipal(req) {
  const principal = await rbac.getPrincipal(req, null);
  if (!principal) return null;
  if (principal.kind === 'admin') return { kind: 'admin', role: principal.role };
  if (principal.kind === 'user' && principal.user) return { kind: 'user', userId: principal.user.id, role: principal.role };
  return null;
}

function openDb() {
  if (dc.pgConnectionString()) return null; // serverless: Postgres via the pool
  return dc.createDb(process.env.DATABASE_PATH || 'talora.db');
}

async function withDb(fn) {
  const db = openDb();
  try { return await fn(db); }
  finally { if (db && db.close) db.close(); }
}

// ---------- multipart/form-data parser (built-in, no new dependency) ----------
// Minimal, bounded parser for single-file uploads: reads the whole body into memory
// with a hard cap (documents are at most 10 MB), then splits parts on the boundary.
function parseMultipart(req, buffer, boundary) {
  const CRLF = '\r\n';
  const delim = Buffer.from('--' + boundary);
  const fields = {};
  let file = null;
  let pos = 0;
  while (pos <= buffer.length) {
    const start = buffer.indexOf(delim, pos);
    if (start === -1) break;
    const headStart = start + delim.length;
    if (buffer.slice(headStart, headStart + 2).toString() === '--') break; // final boundary
    const headEnd = buffer.indexOf(Buffer.from(CRLF + CRLF), headStart);
    if (headEnd === -1) break;
    const head = buffer.slice(headStart, headEnd).toString('utf8');
    const bodyStart = headEnd + 4;
    const bodyEnd = buffer.indexOf(Buffer.from(CRLF + delim), bodyStart);
    if (bodyEnd === -1) break;
    const data = buffer.slice(bodyStart, bodyEnd);

    const headers = {};
    head.split(CRLF).forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    const cd = headers['content-disposition'] || '';
    const nameMatch = /name="([^"]*)"/.exec(cd);
    const fileMatch = /filename="([^"]*)"/.exec(cd);
    const typeMatch = /filename\*=utf-8''([^;\s]+)/.exec(cd);
    const fieldName = nameMatch ? nameMatch[1] : '';
    if (fileMatch || typeMatch) {
      const rawName = fileMatch ? fileMatch[1] : (() => { try { return decodeURIComponent(typeMatch[1]); } catch { return ''; } })();
      file = { field: fieldName, filename: rawName, mimeType: headers['content-type'] || '', data };
    } else if (fieldName) {
      fields[fieldName] = data.toString('utf8');
    }
    pos = bodyEnd + delim.length + 2; // skip past boundary marker + CRLF
  }
  return { fields, file };
}

function boundaryOf(req) {
  const ct = req.headers && (req.headers['content-type'] || req.headers['Content-Type']) || '';
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ct);
  return m ? (m[1] || m[2]) : null;
}

// Collect the request body with a hard cap. Oversize -> 413 before any parsing.
function readBodyLimited(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        const err = new Error('The file is too large.');
        err.status = 413;
        return reject(err);
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// POST /api/documents — multipart/form-data with a "file" part.
async function upload(req, res) {
  if ((req.method || 'POST').toUpperCase() !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { success: false, message: 'Method not allowed.' });
  }
  try {
    const principal = await resolvePrincipal(req);
    if (!principal) {
      return json(res, 401, { success: false, message: 'You must be authenticated to upload documents.' });
    }
    const contentType = req.headers['content-type'] || req.headers['Content-Type'] || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return json(res, 400, { success: false, message: 'Malformed upload. Expected multipart/form-data.' });
    }
    const boundary = boundaryOf(req);
    if (!boundary) {
      return json(res, 400, { success: false, message: 'Malformed upload. Missing multipart boundary.' });
    }
    // Cap = max file size + small multipart framing overhead.
    const buffer = await readBodyLimited(req, dc.MAX_FILE_BYTES + 64 * 1024);

    const { file } = parseMultipart(req, buffer, boundary);
    if (!file || !file.data || file.data.length === 0 || !file.filename) {
      return json(res, 400, { success: false, message: 'Missing file. Please choose a file to upload.' });
    }
    const validation = dc.validateUpload({
      originalFilename: file.filename,
      mimeType: file.mimeType,
      size: file.data.length
    });
    if (!validation.ok) {
      return json(res, validation.status, { success: false, message: validation.message });
    }

    const storedFilename = dc.generateStoredFilename(validation.safeName);
    const filePath = dc.storedFilePath(storedFilename);
    if (!filePath) {
      return json(res, 500, { success: false, message: 'Upload failed. Please try again.' });
    }
    fs.writeFileSync(filePath, file.data);

    try {
      const doc = await withDb((db) => dc.insertDocument(db, {
        userId: principal.kind === 'admin' ? 0 : principal.userId,
        originalFilename: validation.safeName,
        storedFilename,
        mimeType: file.mimeType.toLowerCase(),
        size: file.data.length,
        storagePath: 'documents/' + storedFilename
      }));
      return json(res, 201, { success: true, message: 'Document uploaded successfully.', document: doc });
    } catch (err) {
      try { fs.unlinkSync(filePath); } catch { /* already removed */ }
      throw err;
    }
  } catch (err) {
    console.error('POST /api/documents failed:', err.message);
    return json(res, err.status || 500, { success: false, message: err.status ? err.message : 'Upload failed. Please try again.' });
  }
}

// GET /api/documents — the caller's documents (admin: all documents).
async function list(req, res) {
  if ((req.method || 'GET').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { success: false, message: 'Method not allowed.' });
  }
  try {
    const principal = await resolvePrincipal(req);
    if (!principal) {
      return json(res, 401, { success: false, message: 'You must be authenticated to view documents.' });
    }
    const items = await withDb((db) => dc.listDocuments(db, principal));
    return json(res, 200, { success: true, items });
  } catch (err) {
    console.error('GET /api/documents failed:', err.message);
    return json(res, 500, { success: false, message: 'Failed to load documents.' });
  }
}

// DELETE /api/documents/:id — ownership is verified against the DB row, so changing
// the id in the URL cannot delete someone else's document (403).
async function remove(req, res, id) {
  if ((req.method || 'DELETE').toUpperCase() !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return json(res, 405, { success: false, message: 'Method not allowed.' });
  }
  try {
    const principal = await resolvePrincipal(req);
    if (!principal) {
      return json(res, 401, { success: false, message: 'You must be authenticated to delete documents.' });
    }
    const doc = await withDb((db) => dc.getDocumentById(db, id));
    if (!doc) {
      return json(res, 404, { success: false, message: 'Document not found.' });
    }
    if (!dc.canDelete(principal, doc)) {
      return json(res, 403, { success: false, message: 'You are not authorized to delete this document.' });
    }
    const ok = await withDb((db) => dc.deleteDocument(db, doc));
    if (!ok) {
      return json(res, 404, { success: false, message: 'Document not found.' });
    }
    return json(res, 200, { success: true, message: 'Document deleted successfully.' });
  } catch (err) {
    console.error('DELETE /api/documents/:id failed:', err.message);
    return json(res, 500, { success: false, message: 'Failed to delete document. Please try again.' });
  }
}

module.exports = { upload, list, remove, resolvePrincipal, parseMultipart };
