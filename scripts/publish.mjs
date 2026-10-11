import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const envPath = join(cwd, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const composeArgs = ['compose', '-f', 'compose.yaml', '-f', 'compose.tunnel.yaml'];
const compose = (...args) => execFileSync('docker', [...composeArgs, ...args], { cwd, stdio: 'inherit' });

try {
  process.env.TUNNEL_ENABLED = 'true';
  compose('config', '--quiet');
  compose('up', '-d', '--build', '--wait', '--wait-timeout', '120');
  let url;
  for (let attempt = 0; attempt < 45; attempt++) {
    const logs = execFileSync('docker', [...composeArgs, 'logs', '--no-color', '--tail', '100', 'tunnel'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    url = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)?.at(-1);
    if (url) break;
    await setTimeout(2000);
  }
  if (!url) throw new Error('The tunnel did not issue a public address. Inspect the tunnel container logs.');

  const settings = {
    WEB_BIND: '127.0.0.1', TUNNEL_ENABLED: 'true', DEPLOY_URL: url,
    FRONTEND_ORIGIN: `${url},http://localhost:${process.env.WEB_PORT || 8081},http://127.0.0.1:${process.env.WEB_PORT || 8081}`,
  };
  let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  for (const [key, value] of Object.entries(settings)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
    process.env[key] = value;
  }
  writeFileSync(envPath, env.trim() + '\n');
  compose('up', '-d', '--wait', '--wait-timeout', '120', 'api', 'web');

  let reachable = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok && (await response.json()).status === 'ok') { reachable = true; break; }
    } catch { /* DNS and tunnel registration can take a few seconds. */ }
    await setTimeout(2000);
  }
  if (!reachable) throw new Error(`The public endpoint is not responding: ${url}`);
  execFileSync(process.execPath, ['scripts/deploy.mjs'], { cwd, stdio: 'inherit', env: process.env });
  mkdirSync(join(cwd, '.runtime'), { recursive: true });
  writeFileSync(join(cwd, '.runtime', 'public-url.txt'), url + '\n');
  console.log(`Public deployment verified: ${url}\nKeep this computer, Docker, and the internet connection running. Run npm run publish:public again after a tunnel restart.`);
} catch (error) {
  console.error(`Public deployment not verified: ${error.message}`);
  process.exitCode = 1;
}
