import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hashPassword = promisify(scrypt);
const weights = { NOTIFICATION: 1, APP_SWITCH: 2, MESSAGE_REPLY: 3, FORM_INPUT: 4 };
const preparation = 15 * 60 * 1000;
const localDatabase = fileURLToPath(new URL('./data/firewall.sqlite', import.meta.url));

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function dayOf(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ApiError(400, `${name} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}

function password(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 72) {
    throw new ApiError(400, 'Password is required and must be at most 72 UTF-8 bytes.');
  }
  return value;
}

function instant(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ApiError(400, 'Provide a valid date and time with a timezone.');
  }
  return new Date(value).toISOString();
}

async function readBody(request) {
  // Vercel parses JSON before invoking a Node function.
  if (request.body !== undefined) {
    const size = Buffer.byteLength(typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
    if (size > 16384) throw new ApiError(413, 'Request is too large.');
    let body = request.body;
    try { if (typeof body === 'string') body = JSON.parse(body); }
    catch { throw new ApiError(400, 'Invalid JSON request.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid JSON request.');
    return body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new ApiError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ApiError(400, 'Invalid JSON request.'); }
}

export function createApi({ database = localDatabase, storage, secret = randomBytes(32), now = () => new Date(), allowedOrigins } = {}) {
  if (!storage && database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = storage || new DatabaseSync(database);
  const initialized = Promise.resolve(db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, timezone TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS protect_zones (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decision_events (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), event_type TEXT NOT NULL,
      weight INTEGER NOT NULL, charged_weight INTEGER NOT NULL DEFAULT 0, batched INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT NOT NULL, accounted_at TEXT, hold_until TEXT,
      zone_id INTEGER REFERENCES protect_zones(id)
    );
    CREATE TABLE IF NOT EXISTS daily_battery (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), battery_date TEXT NOT NULL,
      start_capacity INTEGER NOT NULL DEFAULT 100, current_capacity INTEGER NOT NULL,
      updated_at TEXT NOT NULL, UNIQUE(user_id, battery_date)
    );
    CREATE INDEX IF NOT EXISTS events_user_time ON decision_events(user_id, occurred_at);
    CREATE INDEX IF NOT EXISTS zones_user_time ON protect_zones(user_id, starts_at);
  `));
  initialized.catch(() => {});
  const query = (sql, ...params) => db.prepare(sql).all(...params);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);

  async function transaction(callback) {
    if (storage) return storage.transaction(callback);
    db.exec('BEGIN IMMEDIATE');
    try { const result = await callback(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function issueToken(user) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const timestamp = Math.floor(now().getTime() / 1000);
    const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      iss: 'judgmentfirewall-local', sub: String(user.id), iat: timestamp, exp: timestamp + 8 * 3600,
    })}`;
    return `${content}.${createHmac('sha256', secret).update(content).digest('base64url')}`;
  }

  async function authenticate(request) {
    try {
      const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      const parts = token?.split('.');
      if (parts?.length !== 3) throw new Error();
      const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
      const signature = Buffer.from(parts[2], 'base64url');
      const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
      if (header.alg !== 'HS256' || signature.length !== expected.length || !timingSafeEqual(signature, expected)
          || claims.iss !== 'judgmentfirewall-local' || !/^\d+$/.test(claims.sub)
          || !Number.isFinite(claims.exp) || claims.exp <= now().getTime() / 1000) throw new Error();
      const user = (await one('SELECT * FROM users WHERE id = ?', Number(claims.sub)));
      if (!user) throw new Error();
      return user;
    } catch { throw new ApiError(401, 'Your session expired. Please sign in again.'); }
  }

  async function updateBattery(user, date) {
    const applied = (await query('SELECT * FROM decision_events WHERE user_id = ? AND accounted_at IS NOT NULL', user.id))
      .filter(event => dayOf(event.accounted_at, user.timezone) === date);
    const capacity = Math.max(0, 100 - applied.reduce((sum, event) => sum + event.charged_weight, 0));
    (await run(`INSERT INTO daily_battery(user_id, battery_date, current_capacity, updated_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(user_id, battery_date) DO UPDATE SET current_capacity=excluded.current_capacity, updated_at=excluded.updated_at`,
      user.id, date, capacity, now().toISOString()));
    return { capacity, applied };
  }

  async function releaseBatches(user) {
    const pending = (await query('SELECT * FROM decision_events WHERE user_id = ? AND accounted_at IS NULL AND hold_until <= ? ORDER BY id',
      user.id, now().toISOString()));
    const batches = new Map();
    for (const event of pending) {
      if (!batches.has(event.zone_id)) batches.set(event.zone_id, []);
      batches.get(event.zone_id).push(event);
    }
    for (const batch of batches.values()) {
      for (const event of batch) (await run('UPDATE decision_events SET accounted_at = hold_until, charged_weight = 0 WHERE id = ?', event.id));
      (await run('UPDATE decision_events SET charged_weight = ? WHERE id = ?', Math.max(...batch.map(event => event.weight)), batch[0].id));
      (await updateBattery(user, dayOf(batch[0].hold_until, user.timezone)));
    }
  }

  async function dashboard(user, date = dayOf(now(), user.timezone)) {
    (await releaseBatches(user));
    const { capacity, applied } = (await updateBattery(user, date));
    const events = (await query('SELECT * FROM decision_events WHERE user_id = ? ORDER BY occurred_at DESC, id DESC', user.id))
      .filter(event => dayOf(event.occurred_at, user.timezone) === date)
      .map(event => ({ id: event.id, eventType: event.event_type, weight: event.weight,
        chargedWeight: event.charged_weight, occurredAt: event.occurred_at,
        status: event.accounted_at === null ? 'HELD' : event.batched ? 'RELEASED' : 'APPLIED' }));
    const zones = (await query('SELECT * FROM protect_zones WHERE user_id = ? ORDER BY starts_at', user.id))
      .filter(zone => dayOf(zone.ends_at, user.timezone) >= date)
      .map(zone => ({ id: zone.id, title: zone.title, startsAt: zone.starts_at, endsAt: zone.ends_at }));
    const summary = Object.fromEntries(Object.keys(weights).map(type => [type,
      applied.filter(event => event.event_type === type).reduce((sum, event) => sum + event.charged_weight, 0)]));
    return { user: { fullName: user.full_name, email: user.email, timezone: user.timezone }, date,
      capacity, events, zones, summary,
      heldCount: (await one('SELECT COUNT(*) AS count FROM decision_events WHERE user_id = ? AND accounted_at IS NULL', user.id)).count };
  }

  const origins = new Set(allowedOrigins || (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(origin => origin.trim()));
  // Local SQLite shares one connection. Serialize requests so awaited operations
  // cannot accidentally enter another request's transaction.
  let pending = Promise.resolve();
  const execute = task => {
    if (storage) return task();
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  };
  const handler = async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    try {
      await initialized;
      const origin = request.headers.origin;
      if (origin && !origins.has(origin)) throw new ApiError(403, 'Origin is not allowed.');
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
        send(200, {}); return;
      }
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      const method = request.method;
      if (path === '/api/health' && method === 'GET') { send(200, { status: 'ok', mode: storage ? 'cloud' : 'local' }); return; }
      if (path === '/api/auth/register' && method === 'POST') {
        const body = await readBody(request);
        const fullName = text(body.fullName, 'Full name', 100);
        const email = text(body.email, 'Email', 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address.');
        const rawPassword = password(body.password);
        if (rawPassword.length < 10) throw new ApiError(400, 'Use at least 10 characters for the password.');
        const timezone = text(body.timezone, 'Timezone', 100);
        try { dayOf(now(), timezone); } catch { throw new ApiError(400, 'Invalid timezone.'); }
        const salt = randomBytes(16).toString('hex');
        const hash = await hashPassword(rawPassword, salt, 64);
        let result;
        try {
          result = (await run('INSERT INTO users(full_name, email, password_hash, timezone, created_at) VALUES(?, ?, ?, ?, ?)',
            fullName, email, `${salt}:${hash.toString('hex')}`, timezone, now().toISOString()));
        } catch (error) {
          if (error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE'
              || error.code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed: users\.email/i.test(error.message)) {
            throw new ApiError(409, 'An account with this email already exists.');
          }
          throw error;
        }
        send(200, { token: issueToken({ id: result.lastInsertRowid }) }); return;
      }
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await readBody(request);
        const email = text(body.email, 'Email', 254).toLowerCase();
        const rawPassword = password(body.password);
        const user = (await one('SELECT * FROM users WHERE email = ?', email));
        const [salt, storedHash] = (user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
        const hash = await hashPassword(rawPassword, salt, 64);
        if (!user || !timingSafeEqual(hash, Buffer.from(storedHash, 'hex'))) throw new ApiError(401, 'Email or password is incorrect.');
        send(200, { token: issueToken(user) }); return;
      }
      const user = (await authenticate(request));
      if (path === '/api/dashboard' && method === 'GET') {
        const date = url.searchParams.get('date') || dayOf(now(), user.timezone);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
            || new Date(date).toISOString().slice(0, 10) !== date) throw new ApiError(400, 'Invalid date.');
        send(200, (await transaction(async () => (await dashboard(user, date))))); return;
      }
      if (path === '/api/events' && method === 'POST') {
        const body = await readBody(request);
        if (typeof body.eventType !== 'string' || !Object.hasOwn(weights, body.eventType)) throw new ApiError(400, 'Invalid event type.');
        const result = (await transaction(async () => {
          (await releaseBatches(user));
          const occurredAt = now().toISOString();
          const zone = body.eventType === 'NOTIFICATION'
            ? (await query('SELECT * FROM protect_zones WHERE user_id = ? ORDER BY starts_at', user.id))
              .find(zone => now().getTime() >= Date.parse(zone.starts_at) - preparation && now().getTime() < Date.parse(zone.ends_at)) : null;
          (await run(`INSERT INTO decision_events(user_id,event_type,weight,charged_weight,batched,occurred_at,accounted_at,hold_until,zone_id)
            VALUES(?,?,?,?,?,?,?,?,?)`, user.id, body.eventType, weights[body.eventType], zone ? 0 : weights[body.eventType], zone ? 1 : 0,
            occurredAt, zone ? null : occurredAt, zone?.ends_at || null, zone?.id || null));
          return (await dashboard(user));
        }));
        send(200, result); return;
      }
      if (path === '/api/zones' && method === 'POST') {
        const body = await readBody(request);
        const title = text(body.title, 'Title', 120);
        const start = instant(body.startsAt), end = instant(body.endsAt);
        if (start >= end || Date.parse(end) <= now().getTime() || Date.parse(end) - Date.parse(start) > 86400000) {
          throw new ApiError(400, 'The zone must end in the future and last no more than 24 hours.');
        }
        const result = (await transaction(async () => {
          const overlaps = (await query('SELECT * FROM protect_zones WHERE user_id = ?', user.id))
            .some(zone => Date.parse(start) - preparation < Date.parse(zone.ends_at) && Date.parse(end) > Date.parse(zone.starts_at) - preparation);
          if (overlaps) throw new ApiError(409, 'Leave at least 15 minutes between zones.');
          (await run('INSERT INTO protect_zones(user_id,title,starts_at,ends_at) VALUES(?,?,?,?)', user.id, title, start, end));
          return (await dashboard(user));
        }));
        send(200, result); return;
      }
      if (/^\/api\/zones\/\d+$/.test(path) && method === 'DELETE') {
        const result = (await transaction(async () => {
          const zone = (await one('SELECT * FROM protect_zones WHERE id = ? AND user_id = ?', Number(path.split('/').at(-1)), user.id));
          if (!zone) throw new ApiError(404, 'Zone not found.');
          if (now().getTime() >= Date.parse(zone.starts_at) - preparation) throw new ApiError(409, 'This zone has already started its preparation period.');
          (await run('DELETE FROM protect_zones WHERE id = ?', zone.id));
          return (await dashboard(user));
        }));
        send(200, result); return;
      }
      throw new ApiError(404, 'Route not found.');
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Local API error:', error.code || error.name);
      send(error.status || 500, error instanceof ApiError ? { message: error.message } : { message: 'Server error. Please try again.' });
    }
  };
  const server = createServer((request, response) => execute(() => handler(request, response)));
  // Serverless invocations release due batches when reading/writing a dashboard.
  const timer = storage ? null : setInterval(() => execute(async () => {
    try { await initialized; for (const user of (await query('SELECT * FROM users'))) (await transaction(async () => (await releaseBatches(user)))); }
    catch (error) { console.error('Batch release failed:', error.code || error.name); }
  }), 15000);
  timer?.unref();
  server.once('close', () => { clearInterval(timer); db.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const database = process.env.DATABASE_PATH || localDatabase;
  mkdirSync(dirname(database), { recursive: true });
  const keyPath = resolve(dirname(database), 'session.key');
  try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const secret = readFileSync(keyPath);
  if (secret.length !== 32) throw new Error('The session key must contain exactly 32 bytes.');
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '127.0.0.1';
  const server = createApi({ database, secret }).listen(port, host, () => console.log(`API running at http://${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
}
