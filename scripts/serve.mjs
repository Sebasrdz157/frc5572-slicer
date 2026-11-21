// Tiny static file server for local testing: node scripts/serve.mjs [port]
// Serves ./site under /frc5572-slicer/ to mimic GitHub Pages' sub-path.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const base = '/frc5572-slicer/';
const port = Number(process.argv[2] || 8080);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.stl': 'model/stl', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain'
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === base.slice(0, -1)) { res.writeHead(302, { Location: base }); return res.end(); }
  if (!url.startsWith(base)) { res.writeHead(404); return res.end('not found'); }
  let file = path.join(root, url.slice(base.length));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, () => console.log(`serving http://localhost:${port}${base}`));
