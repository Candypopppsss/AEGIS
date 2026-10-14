import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = new URL(process.env.TEST_URL || 'https://aegis-ten-topaz.vercel.app');
assert.equal(base.protocol, 'https:', 'Use the public HTTPS production URL.');
const stateFile = new URL('../.runtime/production-verification.json', import.meta.url);
const mode = process.argv[2] || 'create';
assert.ok(['create', 'verify'].includes(mode));

async function call(path, { body, token, method = body ? 'POST' : 'GET', status = 200, origin = base.origin } = {}) {
  const response = await fetch(new URL('/api' + path, base), {
    method, headers: { Origin: origin, ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, status, `${method} ${path} returned ${response.status}`);
  return response.json();
}

assert.equal((await call('/health')).status, 'ok');
if (mode === 'create') {
  const account = { fullName: 'Production QA', email: `qa-${randomUUID()}@college.edu`, password: randomUUID(), timezone: 'UTC' };
  const { token } = await call('/auth/register', { body: account });
  await call('/auth/register', { body: account, status: 409 });
  await call('/auth/login', { body: { email: account.email, password: 'incorrect-password' }, status: 401 });
  await call('/dashboard', { status: 401 });
  await call('/dashboard', { token: token.slice(0, -5) + 'xxxxx', status: 401 });
  await call('/health', { origin: 'https://untrusted.example', status: 403 });
  assert.equal((await call('/dashboard', { token })).capacity, 100);
  for (const eventType of ['NOTIFICATION', 'APP_SWITCH', 'MESSAGE_REPLY', 'FORM_INPUT']) {
    await call('/events', { token, body: { eventType } });
  }
  const dashboard = await call('/dashboard', { token });
  assert.equal(dashboard.capacity, 90);
  assert.equal(dashboard.events.length, 4);
  const zone = { title: 'Persistence QA', startsAt: '2099-01-01T10:00:00Z', endsAt: '2099-01-01T11:00:00Z' };
  const saved = await call('/zones', { token, body: zone });
  assert.equal(saved.zones.length, 1);
  await call('/zones', { token, body: zone, status: 409 });
  await mkdir(new URL('../.runtime/', import.meta.url), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ account, token, zoneId: saved.zones[0].id }), { mode: 0o600 });
  console.log('Production health, signup, duplicate accounts, login errors, authentication, origins, all event types, and zones passed. QA records saved for verification after redeployment.');
} else {
  const { account, token: oldToken, zoneId } = JSON.parse(await readFile(stateFile, 'utf8'));
  const { token } = await call('/auth/login', { body: { email: account.email, password: account.password } });
  for (const session of [oldToken, token]) {
    const saved = await call('/dashboard', { token: session });
    assert.equal(saved.user.email, account.email);
    assert.equal(saved.capacity, 90);
    assert.equal(saved.events.length, 4);
    assert.ok(saved.zones.some(zone => zone.id === zoneId));
  }
  const removed = await call(`/zones/${zoneId}`, { token, method: 'DELETE' });
  assert.equal(removed.zones.length, 0);
  console.log('After redeployment: existing account, password, session, four events, battery, and saved zone survived; zone removal passed.');
}
