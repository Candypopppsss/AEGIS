import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from './server.mjs';

async function fixture(t, options = {}) {
  let current = new Date('2026-10-11T09:00:00Z');
  const server = createApi({ database: ':memory:', now: () => current, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(path, body, token, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  async function register(email = 'test@college.edu', timezone = 'UTC') {
    const result = await call('/auth/register', { fullName: 'Test User', email, password: 'test-password-123', timezone });
    assert.equal(result.status, 200);
    return result.data.token;
  }
  return { call, register, server, base, setTime: value => { current = new Date(value); } };
}

test('registration, duplicate detection, and real password verification', async t => {
  const { call, register } = await fixture(t);
  const token = await register();
  assert.equal((await call('/dashboard', null, token)).data.capacity, 100);
  assert.equal((await call('/auth/register', { fullName: 'User', email: 'TEST@college.edu', password: 'test-password-123', timezone: 'UTC' })).status, 409);
  assert.equal((await call('/auth/login', { email: 'test@college.edu', password: 'wrong-password' })).status, 401);
  assert.equal((await call('/auth/login', { email: 'TEST@college.edu', password: 'test-password-123' })).status, 200);
});

test('tokens cannot be forged and expired sessions are rejected', async t => {
  const { call, register, setTime } = await fixture(t);
  const token = await register();
  assert.equal((await call('/dashboard')).status, 401);
  assert.equal((await call('/dashboard', null, token + 'x')).status, 401);
  setTime('2026-10-11T17:00:01Z');
  assert.equal((await call('/dashboard', null, token)).status, 401);
});

test('event weights are assigned by the server and accounts stay isolated', async t => {
  const { call, register } = await fixture(t);
  const first = await register();
  const second = await register('other@college.edu');
  for (const eventType of ['NOTIFICATION', 'APP_SWITCH', 'MESSAGE_REPLY', 'FORM_INPUT']) {
    assert.equal((await call('/events', { eventType, weight: -100 }, first)).status, 200);
  }
  assert.equal((await call('/dashboard', null, first)).data.capacity, 90);
  const isolated = (await call('/dashboard', null, second)).data;
  assert.equal(isolated.capacity, 100);
  assert.equal(isolated.events.length, 0);
});

test('notifications batch until zone end and are charged only once', async t => {
  const { call, register, setTime } = await fixture(t);
  const token = await register();
  const zone = { title: 'Interview', startsAt: '2026-10-11T09:10:00Z', endsAt: '2026-10-11T09:30:00Z' };
  assert.equal((await call('/zones', zone, token)).status, 200);
  await call('/events', { eventType: 'NOTIFICATION' }, token);
  await call('/events', { eventType: 'NOTIFICATION' }, token);
  let result = (await call('/events', { eventType: 'MESSAGE_REPLY' }, token)).data;
  assert.equal(result.capacity, 97);
  assert.equal(result.heldCount, 2);
  setTime('2026-10-11T09:30:00Z');
  result = (await call('/dashboard', null, token)).data;
  assert.equal(result.capacity, 96);
  assert.equal(result.heldCount, 0);
  assert.equal(result.summary.NOTIFICATION, 1);
  assert.equal((await call('/dashboard', null, token)).data.capacity, 96);
});

test('overlapping and invalid zones are rejected; deletion is owner-only', async t => {
  const { call, register } = await fixture(t);
  const owner = await register();
  const other = await register('other@college.edu');
  const zone = { title: 'Exam', startsAt: '2026-10-11T10:00:00Z', endsAt: '2026-10-11T11:00:00Z' };
  const result = await call('/zones', zone, owner);
  assert.equal(result.status, 200);
  const id = result.data.zones[0].id;
  assert.equal((await call('/zones', zone, owner)).status, 409);
  assert.equal((await call('/zones', { ...zone, endsAt: zone.startsAt }, owner)).status, 400);
  assert.equal((await call(`/zones/${id}`, null, other, 'DELETE')).status, 404);
  assert.equal((await call(`/zones/${id}`, null, owner, 'DELETE')).status, 200);
});

test('the preparation period protects notifications and prevents deletion', async t => {
  const { call, register, setTime } = await fixture(t);
  const token = await register();
  const result = await call('/zones', { title: 'Exam', startsAt: '2026-10-11T10:00:00Z', endsAt: '2026-10-11T11:00:00Z' }, token);
  setTime('2026-10-11T09:44:59Z');
  assert.equal((await call('/events', { eventType: 'NOTIFICATION' }, token)).data.capacity, 99);
  setTime('2026-10-11T09:45:00Z');
  assert.equal((await call('/events', { eventType: 'NOTIFICATION' }, token)).data.capacity, 99);
  assert.equal((await call(`/zones/${result.data.zones[0].id}`, null, token, 'DELETE')).status, 409);
});

test('a timezone midnight resets the battery and preserves yesterday', async t => {
  const { call, register, setTime } = await fixture(t);
  setTime('2026-10-11T18:29:00Z');
  const token = await register('test@college.edu', 'Asia/Kolkata');
  assert.equal((await call('/events', { eventType: 'FORM_INPUT' }, token)).data.capacity, 96);
  setTime('2026-10-11T18:31:00Z');
  const result = (await call('/dashboard', null, token)).data;
  assert.equal(result.date, '2026-10-12');
  assert.equal(result.capacity, 100);
  assert.equal((await call('/dashboard?date=2026-10-11', null, token)).data.capacity, 96);
});

test('capacity never drops below zero, even with concurrent events', async t => {
  const { call, register } = await fixture(t);
  const token = await register();
  const results = await Promise.all(Array.from({ length: 30 }, () => call('/events', { eventType: 'FORM_INPUT' }, token)));
  assert.ok(results.every(result => result.status === 200));
  const result = (await call('/dashboard', null, token)).data;
  assert.equal(result.capacity, 0);
  assert.equal(result.events.length, 30);
});

test('invalid input, SQL-like email input, and untrusted origins are rejected', async t => {
  const { call, register, base } = await fixture(t);
  const token = await register();
  assert.equal((await call('/events', { eventType: '__proto__' }, token)).status, 400);
  assert.equal((await call('/dashboard?date=2026-02-30', null, token)).status, 400);
  assert.equal((await call('/auth/register', { fullName: 'User', email: "' OR 1=1 --", password: 'test-password-123', timezone: 'UTC' })).status, 400);
  assert.equal((await call('/auth/register', { fullName: 'User', email: 'user@college.edu', password: 'test-password-123', timezone: 'Invalid/Zone' })).status, 400);
  const invalid = await fetch(base + '/auth/register', { method: 'POST', body: '{invalid' });
  assert.equal(invalid.status, 400);
  const forbidden = await fetch(base + '/health', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(forbidden.status, 403);
});

test('accounts and events survive restart, and passwords are not stored in plain text', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'judgment-api-'));
  const database = join(directory, 'test.sqlite');
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('judgment-api-'));
    rmSync(directory, { recursive: true });
  });
  const first = await fixture(t, { database });
  const token = await first.register();
  await first.call('/events', { eventType: 'FORM_INPUT' }, token);
  await new Promise(resolve => first.server.close(resolve));
  const second = await fixture(t, { database });
  const login = await second.call('/auth/login', { email: 'test@college.edu', password: 'test-password-123' });
  assert.equal(login.status, 200);
  assert.equal((await second.call('/dashboard', null, login.data.token)).data.capacity, 96);
  const db = new DatabaseSync(database);
  const record = db.prepare('SELECT password_hash FROM users').get();
  assert.notEqual(record.password_hash, 'test-password-123');
  assert.match(record.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  db.close();
  await new Promise(resolve => second.server.close(resolve));
});
