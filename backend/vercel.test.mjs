import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

test('Vercel adapter accepts parsed bodies and rewritten API URLs without allowing unrelated origins', async t => {
  process.env.TURSO_DATABASE_URL = 'file::memory:';
  process.env.TURSO_AUTH_TOKEN = 'local-test';
  process.env.SESSION_SECRET = randomUUID();
  process.env.VERCEL_URL = 'aegis-test.vercel.app';
  const { default: api } = await import('../api/index.mjs');
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') {
      let content = '';
      for await (const chunk of request) content += chunk;
      request.body = JSON.parse(content);
    }
    await api(request, response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/index?route=`;
  const headers = { Origin: 'https://aegis-test.vercel.app', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + 'health', { headers })).status, 200);
  assert.equal((await fetch(base + 'health', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const register = await fetch(base + 'auth/register', {
    method: 'POST', headers, body: JSON.stringify({ fullName: 'Serverless check', email: 'vercel@college.edu', password: 'test-password-123', timezone: 'UTC' }),
  });
  assert.equal(register.status, 200);
  const { token } = await register.json();
  const response = await fetch(base + 'events', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ eventType: 'FORM_INPUT' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).capacity, 96);
  const invalid = await fetch(base + 'events', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify([]) });
  assert.equal(invalid.status, 400);
});
