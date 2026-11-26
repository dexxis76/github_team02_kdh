// 내 컴퓨터에서 public + /api 를 함께 띄운다:  node --env-file=.env server.js
// Vercel 에서는 이 파일을 쓰지 않는다(public 은 정적 파일, api 는 서버리스 함수).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/$/, '');
    if (!/^[a-z]+$/.test(name)) { res.writeHead(404); return res.end('not found'); }
    const file = path.join(__dirname, 'api', name + '.js');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"없는 API"}'); }
    let raw = '';
    for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
    try { await require(file)(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: '서버 오류: ' + e.message }); }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  if (p === '/terms') p = '/terms.html';
  const f = path.join(PUB, p);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (관리자: /admin)`));
