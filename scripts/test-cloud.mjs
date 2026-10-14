import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = mkdtempSync(join(tmpdir(), 'aegis-cloud-tests-'));
try {
  const result = spawnSync(process.execPath, ['--test', 'local-api/server.test.mjs', 'local-api/vercel.test.mjs', 'local-api/spring-proxy.test.mjs'], {
    stdio: 'inherit', env: { ...process.env, AEGIS_TEST_STORAGE: 'cloud', AEGIS_TEST_DIRECTORY: directory },
  });
  process.exitCode = result.status ?? 1;
} finally {
  // The Windows native libSQL driver can retain file handles until process exit.
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  rmSync(directory, { recursive: true, maxRetries: 10, retryDelay: 100 });
}
