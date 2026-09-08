const http = require('http');
const fs = require('fs');
const path = require('path');
const { createDb, validateAndStore } = require('./contact-core');
const root = __dirname;
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.ico':'image/x-icon'};

// ---- Database (SQLite, persisted on disk) ----
const db = createDb(path.join(root, process.env.DATABASE_PATH || 'talora.db'));

function handleContact(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
  req.on('end', async () => {
    const result = await validateAndStore(db, body);
    if (result.ok) {
      return sendJson(res, result.status, { success: true, message: 'Your message has been sent successfully.', id: result.id });
    }
    return sendJson(res, result.status, { success: false, message: result.message });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/api/contact') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
      return res.end(JSON.stringify({ success: false, message: 'Method not allowed.' }));
    }
    return handleContact(req, res);
  }
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(5501, () => console.log('Serving at http://localhost:5501 (contact API: POST /api/contact)'));
