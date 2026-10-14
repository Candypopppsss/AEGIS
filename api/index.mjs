import { createApi } from '../local-api/server.mjs';
import { createCloudStorage } from '../local-api/cloud-storage.mjs';

let handler;
export default async function api(request, response) {
  if (!handler) {
    const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, SESSION_SECRET } = process.env;
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN || !SESSION_SECRET || Buffer.byteLength(SESSION_SECRET) < 32) {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ message: 'The deployment database and session secret must be configured.' }));
      return;
    }
    const hosts = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean);
    const allowedOrigins = [...hosts.map(host => `https://${host}`), ...(process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)];
    const server = createApi({
      storage: createCloudStorage({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN }),
      secret: Buffer.from(SESSION_SECRET), allowedOrigins,
    });
    [handler] = server.listeners('request');
  }
  const url = new URL(request.url, 'http://localhost');
  const route = url.searchParams.get('route') || request.query?.route;
  if (route) {
    url.pathname = `/api/${Array.isArray(route) ? route.join('/') : route}`;
    url.searchParams.delete('route');
    request.url = url.pathname + url.search;
  }
  return handler(request, response);
}
