import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'aegis-repo-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'scripts'));
  copyFileSync(new URL('./check-repo.mjs', import.meta.url), join(cwd, 'scripts/check-repo.mjs'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('init');
  const stage = (name, content) => {
    writeFileSync(join(cwd, name), content);
    git('add', '--', name);
  };
  const check = (...args) => spawnSync(process.execPath, ['scripts/check-repo.mjs', ...args], { cwd, encoding: 'utf8' });
  return { cwd, git, stage, check };
}

test('placeholder environment examples pass', t => {
  const { stage, check } = repository(t);
  stage('.env.docker.example', 'WEB_PORT=8081\nJWT_SECRET=YOUR_SECRET_HERE\n');
  assert.equal(check().status, 0);
});

test('staged environment files are blocked without printing their contents', t => {
  const { stage, check } = repository(t);
  stage('.env', 'PASSWORD=private-test-value\n');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Private file in Git: \.env/);
  assert.ok(!result.stderr.includes('private-test-value'));
});

test('staged credentials remain blocked after an unstaged cleanup', t => {
  const { cwd, stage, check } = repository(t);
  const credential = ['ghp', '_', 'a'.repeat(36)].join('');
  stage('config.txt', credential);
  writeFileSync(join(cwd, 'config.txt'), 'clean');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Possible GitHub token: config.txt/);
  assert.ok(!result.stderr.includes(credential));
});

test('history scan catches a private file removed from the current tree', t => {
  const { stage, git, check } = repository(t);
  stage('.env', 'PASSWORD=private-test-value\n');
  git('-c', 'user.name=Repo Check', '-c', 'user.email=check@example.invalid', 'commit', '-m', 'fixture');
  git('rm', '.env');
  git('-c', 'user.name=Repo Check', '-c', 'user.email=check@example.invalid', 'commit', '-m', 'remove fixture');
  assert.equal(check().status, 0);
  const result = check('--history');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Private file in Git: \.env/);
});
