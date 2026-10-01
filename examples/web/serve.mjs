// Tiny static file server for the web tier. Serves the scenes workspace root so pages can reach /assets and /web.
//   node web/serve.mjs [port]      (default 4177; prints the URL)
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.wav': 'audio/wav',
  '.css': 'text/css; charset=utf-8', '.map': 'application/json',
};

export function startServer(port = 4177) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end('forbidden'); return; }
    let stat;
    try { stat = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
    if (stat.isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise(resolveListen => server.listen(port, '127.0.0.1', () => resolveListen(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4177);
  await startServer(port);
  console.log(`serving ${ROOT} at http://127.0.0.1:${port}/`);
}
