import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const engineReady = () => spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  cwd, stdio: 'ignore', timeout: 10000,
}).status === 0;

try {
  if (process.platform !== 'win32') throw new Error('On this platform, start your Docker engine and run npm run deploy.');
  if (!engineReady()) {
    const candidates = [
      join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'Docker Desktop.exe'),
    ];
    const desktop = candidates.find(existsSync);
    if (!desktop) throw new Error('Docker Desktop was not found. Start your installed Docker Desktop manually, then retry.');
    console.log('Starting Docker Desktop...');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Process -FilePath $env:AEGIS_DOCKER_DESKTOP -WindowStyle Hidden'], {
      cwd, stdio: 'inherit', env: { ...process.env, AEGIS_DOCKER_DESKTOP: desktop },
    });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (engineReady()) break;
      await delay(2000);
    }
    if (!engineReady()) {
      console.error('Docker did not become ready. Collecting engine and WSL diagnostics:');
      for (const [command, args] of [['docker', ['info']], ['wsl.exe', ['--status']], ['wsl.exe', ['--list', '--verbose']]]) {
        spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 15000 });
      }
      throw new Error('Check the Docker Desktop window for its startup error. No Docker data was reset.');
    }
  }
  console.log('Docker engine is ready. Building and verifying AEGIS...');
  execFileSync(process.execPath, [join(cwd, 'scripts', 'deploy.mjs')], { cwd, stdio: 'inherit' });
} catch (error) {
  console.error(`Docker startup/deployment failed: ${error.message}`);
  process.exitCode = 1;
}
