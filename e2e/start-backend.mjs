// Starts the real Django API for browser acceptance runs: migrates an isolated
// temporary SQLite database, then serves on 127.0.0.1:8000. No mocks.
//   COURSEPATH_PYTHON       Python interpreter with the backend requirements (default: python)
//   COURSEPATH_BACKEND_DIR  Repository checkout containing server/manage.py (default: repo root)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(process.env.COURSEPATH_BACKEND_DIR ?? path.join(here, '..'));
const python = process.env.COURSEPATH_PYTHON ?? 'python';
const manage = path.join(backend, 'server', 'manage.py');
if (!existsSync(manage)) {
  console.error(`server/manage.py not found under ${backend}. The Django backend (Harsh's server/) must be present; set COURSEPATH_BACKEND_DIR.`);
  process.exit(1);
}
// Playwright force-stops this server at the end of a run, so it cannot delete its
// own database; remove the ones earlier runs left behind before creating a new one.
for (const name of readdirSync(tmpdir())) {
  if (!name.startsWith('coursepath-e2e-')) continue;
  try {
    rmSync(path.join(tmpdir(), name), { recursive: true, force: true });
  } catch {
    // Still in use by another process; leave it.
  }
}
const dbDir = mkdtempSync(path.join(tmpdir(), 'coursepath-e2e-'));
const env = { ...process.env, COURSEPATH_ENV: 'development', COURSEPATH_SQLITE_PATH: path.join(dbDir, 'e2e.sqlite3'), PYTHONUNBUFFERED: '1' };
const migrate = spawnSync(python, [manage, 'migrate', '--noinput'], { cwd: backend, env, stdio: 'inherit' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
const server = spawn(python, [manage, 'runserver', '127.0.0.1:8000', '--noreload'], { cwd: backend, env, stdio: 'inherit' });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
