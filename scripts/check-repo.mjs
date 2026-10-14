import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

function privatePath(path) {
  const parts = path.toLowerCase().split('/');
  const name = parts.at(-1);
  return parts.some(part => ['.aws', '.ssh', '.codex', '.agents', '.vercel', '.runtime',
    'secrets', 'credentials', 'node_modules', 'data', 'target', 'dist'].includes(part))
    || (name === '.env' || name.startsWith('.env.')) && !name.endsWith('.example')
    || ['.envrc', 'credentials.json', 'auth.json', '.npmrc', '.pypirc'].includes(name)
    || /^service-account.*\.json$/.test(name)
    || /\.(pem|key|p12|pfx|jks|db|sqlite|sqlite3|dump|log)(-.*)?$/.test(name)
    || /^id_(rsa|ed25519)/.test(name);
}

// Report filenames and categories only; never print credential values.
const signatures = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['API secret key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['JWT credential', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}\b/],
  ['database URL credentials', /\b(?:mysql|postgres(?:ql)?|libsql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@/i],
  ['package registry token', /_authToken\s*=\s*(?!\$\{)[A-Za-z0-9_-]{20,}/],
];
let failures = 0;
function inspect(path, content) {
  if (privatePath(path)) {
    console.error(`Private file in Git: ${path}`);
    failures++;
  }
  for (const [label, pattern] of signatures) {
    if (pattern.test(content)) {
      console.error(`Possible ${label}: ${path}`);
      failures++;
    }
  }
}

const files = git('ls-files', '-z').split('\0').filter(Boolean);
for (const path of files) {
  inspect(path, git('show', `:${path}`));
  // Check unstaged edits too, without overlooking a secret still in the index.
  let content;
  try { content = readFileSync(new URL(path, new URL('../', import.meta.url)), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (content !== undefined) inspect(path, content);
}

if (process.argv.includes('--history')) {
  const objects = git('rev-list', '--objects', '--all').trim().split('\n');
  for (const object of objects) {
    const separator = object.indexOf(' ');
    if (separator < 0) continue;
    const id = object.slice(0, separator);
    const path = object.slice(separator + 1);
    if (git('cat-file', '-t', id).trim() === 'blob') inspect(path, git('cat-file', 'blob', id));
  }
}

if (failures) {
  console.error('Repository check failed. Remove private files and credentials from Git before pushing.');
  process.exitCode = 1;
} else {
  console.log(`Repository check passed (${files.length} tracked files${process.argv.includes('--history') ? ' and local Git history' : ''}).`);
}
