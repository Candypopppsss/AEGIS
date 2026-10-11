import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(join(cwd, '.env'))) process.loadEnvFile(join(cwd, '.env'));
const baseUrl = (process.env.DEPLOY_URL || `http://127.0.0.1:${process.env.WEB_PORT || 8081}`).replace(/\/$/, '');
const docker = (...args) => execFileSync('docker', args, { cwd, stdio: 'inherit' });
const compose = (...args) => docker('compose',
  ...(process.env.PUBLIC_DOMAIN ? ['-f', 'compose.yaml', '-f', 'compose.public.yaml'] : []),
  ...args);

async function request(path, { body, token } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: baseUrl,
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}.`);
  return response.json();
}

try {
  try { docker('info', '--format', '{{.ServerVersion}}'); }
  catch {
    throw new Error('Docker engine is unavailable. Start Docker Desktop or run node scripts/start-docker.mjs.');
  }
  compose('config', '--quiet');
  compose('up', '-d', '--build', '--wait', '--wait-timeout', '120');

  execFileSync(process.execPath, ['--test', 'frontend/tests/live.test.mjs'], {
    cwd, stdio: 'inherit', env: { ...process.env, TEST_URL: baseUrl },
  });

  // Verify account data and the signing key survive an API container restart.
  const account = {
    fullName: 'Deployment Check', email: `deploy-${randomUUID()}@college.edu`,
    password: randomUUID(), timezone: 'UTC',
  };
  const { token } = await request('/auth/register', { body: account });
  const before = await request('/events', { token, body: { eventType: 'FORM_INPUT' } });
  if (before.capacity !== 96) throw new Error('The deployed event score is incorrect.');

  compose('restart', '--no-deps', 'api');
  compose('up', '-d', '--no-recreate', '--wait', '--wait-timeout', '120');
  const after = await request('/dashboard', { token });
  if (after.capacity !== 96) throw new Error('Saved data did not survive the container restart.');
  const login = await request('/auth/login', { body: { email: account.email, password: account.password } });
  if (!login.token) throw new Error('Sign-in failed after the container restart.');

  compose('ps');
  console.log(`Deployment verified: ${baseUrl}`);
  if (process.env.PUBLIC_DOMAIN && baseUrl !== `https://${process.env.PUBLIC_DOMAIN}`) {
    console.log(`HTTPS gateway configured for https://${process.env.PUBLIC_DOMAIN}; public reachability and certificate issuance were not verified by these local checks.`);
  }
} catch (error) {
  console.error(`Deployment not verified: ${error.message}`);
  process.exitCode = 1;
}
