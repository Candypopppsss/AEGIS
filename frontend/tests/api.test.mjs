import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from '../src/api.js';

test('requests send the token and JSON body', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/events');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { eventType: 'NOTIFICATION' });
    return Response.json({ capacity: 99 });
  });
  assert.deepEqual(await request('/events', 'token', { eventType: 'NOTIFICATION' }), { capacity: 99 });
});

test('network failures return an actionable message', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(request('/dashboard', 'token'), /Cannot reach the server/);
});

test('empty unauthorized responses retain the status and session message', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  await assert.rejects(request('/dashboard', 'token'), error => {
    assert.equal(error.status, 401);
    assert.match(error.message, /session expired/);
    return true;
  });
});

test('server validation messages are preserved', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Zones overlap.' }, { status: 409 }));
  await assert.rejects(request('/zones', 'token', {}), /Zones overlap/);
});

test('rate-limited responses ask the user to wait', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  await assert.rejects(request('/auth/login', null, {}), error => {
    assert.equal(error.status, 429);
    assert.match(error.message, /wait a minute/);
    return true;
  });
});

test('HTML responses do not expose JSON parser errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Gateway error</html>'));
  await assert.rejects(request('/dashboard', 'token'), /server returned an invalid response/);
});

test('stalled requests time out instead of leaving the form busy', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = request('/dashboard', 'token');
  const assertion = assert.rejects(pending, /request timed out/);
  t.mock.timers.tick(15000);
  await assertion;
});

test('DELETE sends no JSON body', async t => {
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    assert.equal(options.method, 'DELETE');
    assert.equal(options.body, undefined);
    assert.equal(options.headers['Content-Type'], undefined);
    return Response.json({ zones: [] });
  });
  await request('/zones/1', 'token', null, 'DELETE');
});
