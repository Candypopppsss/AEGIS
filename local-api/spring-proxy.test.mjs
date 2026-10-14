import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createSpringProxy } from './spring-proxy.mjs';

test('Vercel Spring adapter forwards signup and authenticated requests without Turso credentials', async t => {
  process.env.SPRING_API_URL = 'https://spring.example';
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.SESSION_SECRET;
  const nativeFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://spring.example')) return nativeFetch(url, options);
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ token: 'spring-session' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => { globalThis.fetch = nativeFetch; delete process.env.SPRING_API_URL; });
  const { default: api } = await import('../api/index.mjs');
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      request.body = JSON.parse(body);
    }
    await api(request, response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/index?route=`;
  const account = { fullName: 'Test User', email: 'test@example.com', password: 'password-123', timezone: 'UTC' };
  const result = await nativeFetch(base + 'auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://aegis.example' },
    body: JSON.stringify(account),
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).token, 'spring-session');
  assert.equal(calls[0].url, 'https://spring.example/api/auth/register');
  assert.deepEqual(JSON.parse(calls[0].body), account);
  assert.equal(calls[0].headers.origin, 'https://aegis.example');
  await nativeFetch(base + 'dashboard&date=2026-10-14', { headers: { Authorization: 'Bearer spring-session' } });
  assert.equal(calls[1].url, 'https://spring.example/api/dashboard?date=2026-10-14');
  assert.equal(calls[1].headers.authorization, 'Bearer spring-session');
});

async function invoke(fetchImpl, overrides = {}) {
  const request = { url: '/api/auth/login', method: 'POST', headers: {}, body: { email: 'user@example.com' }, ...overrides };
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await createSpringProxy('https://spring.example', { fetchImpl })(request, response);
  return response;
}

test('Spring errors retain their status, message, and authentication headers', async () => {
  const result = await invoke(async () => new Response('{"message":"Email or password is incorrect."}', {
    status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
  }));
  assert.equal(result.status, 401);
  assert.equal(JSON.parse(result.body).message, 'Email or password is incorrect.');
  assert.equal(result.headers['www-authenticate'], 'Bearer');
});

test('Spring outage returns a retryable message without disclosing connection details', async () => {
  const result = await invoke(async () => { throw new Error('private connection details'); });
  assert.equal(result.status, 503);
  assert.doesNotMatch(result.body.toString(), /private/);
});

test('oversized parsed and streamed bodies are rejected before forwarding', async () => {
  const fetchImpl = async () => { assert.fail('oversized request was forwarded'); };
  assert.equal((await invoke(fetchImpl, { body: 'x'.repeat(16385) })).status, 413);
  const streamed = { body: undefined, async *[Symbol.asyncIterator]() { yield Buffer.alloc(16385); } };
  assert.equal((await invoke(fetchImpl, streamed)).status, 413);
});

test('configured upstream must be an HTTPS origin', () => {
  for (const url of ['http://spring.example', 'https://user:password@spring.example', 'https://spring.example/api', 'https://spring.example?redirect=1']) {
    assert.throws(() => createSpringProxy(url), /HTTPS origin/);
  }
});
