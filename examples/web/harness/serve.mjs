// Minimal static server for the harness page: this folder, plus Phaser's browser build at /phaser.js.
//   node serve.mjs [port]      (default 5199)
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PHASER = join(ROOT, 'node_modules/phaser/dist/phaser.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const port = Number(process.argv[2] ?? process.env.PORT ?? 5199);
http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path === '/phaser.js' ? PHASER : normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (file !== PHASER && (!file.startsWith(ROOT + sep) || file.includes(`${sep}node_modules${sep}`) || file.includes(`${sep}tests${sep}`))) { res.writeHead(403).end('forbidden'); return; }
  let stat;
  try { stat = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
  if (!stat.isFile()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
