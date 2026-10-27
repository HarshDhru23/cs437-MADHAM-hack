import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(here, '..', 'frontend');
// Django API port; set COURSEPATH_E2E_API_PORT when 8000 is taken. The preview proxy follows it.
const apiPort = process.env.COURSEPATH_E2E_API_PORT ?? '8000';
const apiOrigin = `http://127.0.0.1:${apiPort}`;

/**
 * Browser acceptance against the real stack: Django API (isolated temporary
 * SQLite) + the production frontend build served by `vite preview`, which
 * proxies /api to Django and falls back to index.html for deep links.
 * Django's login throttle allows 10 account actions per IP per 15 minutes; the
 * suite stays below that on a fresh database, so retries are disabled.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /responsive\.spec/ },
    { name: 'responsive', use: { ...devices['Desktop Chrome'] }, testMatch: /responsive\.spec/ },
  ],
  webServer: [
    {
      command: 'node start-backend.mjs',
      cwd: here,
      url: `${apiOrigin}/api/v1/session`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run build && npm run preview',
      cwd: frontend,
      env: { COURSEPATH_API_ORIGIN: apiOrigin },
      url: 'http://127.0.0.1:4173/',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
