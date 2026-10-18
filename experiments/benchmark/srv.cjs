const http = require('http'); const fs = require('fs'); const path = require('path');
const MIME = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png'};
http.createServer((q, s) => {
  let p = q.url.split('?')[0];
  if (p === '/') { s.writeHead(200, {'Content-Type':'text/html'}); s.end('<h1>Benchmark</h1><a href=/a/>A</a> <a href=/b/>B</a> <a href=/c/>C</a>'); return; }
  let f = path.join(process.cwd(), 'out', p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end('nf:' + f); }
  const ext = path.extname(f).toLowerCase();
  s.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
  s.end(fs.readFileSync(f));
}).listen(8790, () => console.log('bench server on 8790'));
