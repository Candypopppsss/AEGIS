import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../local-api/server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const webRoot = await realpath(resolve(root, 'frontend/dist'));
await stat(resolve(webRoot, 'index.html'));
const database = resolve(process.env.DATABASE_PATH || resolve(root, 'local-api/data/firewall.sqlite'));
await mkdir(dirname(database), { recursive: true });
const keyPath = resolve(dirname(database), 'session.key');
try { await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const secret = await readFile(keyPath);
if (secret.length !== 32) throw new Error('The session key must contain exactly 32 bytes.');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8081);
// Render supplies the assigned HTTPS URL, including when the service name changes.
process.env.FRONTEND_ORIGIN ||= process.env.RENDER_EXTERNAL_URL
  || `http://localhost:${port},http://127.0.0.1:${port}`;
const server = createApi({ database, secret });
const [apiHandler] = server.listeners('request');
server.removeAllListeners('request');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

server.on('request', async (request, response) => {
  const pathname = (request.url || '/').split('?')[0];
  if (pathname === '/api' || pathname.startsWith('/api/')) return apiHandler(request, response);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  try {
    const decoded = decodeURIComponent(pathname);
    const target = resolve(webRoot, `.${decoded}`);
    if (target !== webRoot && !target.startsWith(webRoot + sep)) {
      response.writeHead(403); response.end(); return;
    }
    let file;
    try {
      file = await realpath(target);
      if (file !== webRoot && !file.startsWith(webRoot + sep)) { response.writeHead(403); response.end(); return; }
      if (!(await stat(file)).isFile()) file = resolve(webRoot, 'index.html');
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      if (decoded.startsWith('/assets/') || extname(decoded)) { response.writeHead(404); response.end(); return; }
      file = resolve(webRoot, 'index.html');
    }
    const info = await stat(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': file.startsWith(resolve(webRoot, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 500); response.end();
  }
});
server.listen(port, host, () => console.log(`AEGIS deployed at http://${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
