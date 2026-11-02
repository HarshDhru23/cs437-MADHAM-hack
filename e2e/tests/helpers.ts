import { expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Django allows 10 account actions per IP per 15 minutes, and every spec reaches it
 * through the same 127.0.0.1 proxy. Clearing the throttle table of this run's throwaway
 * database gives each new account its own budget, as separate runs would. The throttle
 * itself is tested in server/records/tests.py and server/records/test_privacy.py.
 */
export function resetAccountThrottle() {
  const port = process.env.COURSEPATH_E2E_API_PORT ?? '8000';
  // start-backend.mjs writes this file when it creates the run's database.
  const sqlitePath = readFileSync(path.join(tmpdir(), `coursepath-e2e-${port}.db-path`), 'utf8');
  const script = 'from server.records.models import LoginThrottle; LoginThrottle.objects.all().delete()';
  const result = spawnSync(process.env.COURSEPATH_PYTHON ?? 'python', [path.join(repoRoot, 'server', 'manage.py'), 'shell', '-c', script], {
    cwd: repoRoot,
    env: { ...process.env, COURSEPATH_ENV: 'development', COURSEPATH_SQLITE_PATH: sqlitePath },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Could not reset the e2e account throttle: ${result.stderr}`);
}

export const PASSWORD = 'Synthetic-pass-9183!';

export function uniqueUser(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Synthetic IMS grade table (no real student data). */
export const IMS_TEXT = [
  'Academic Period\tCourse No\tCourse Name\tCredit\tGrade',
  '2025-26 Semester II\tZZ 299\tSynthetic Project\t4\tA',
  '2025-26 Semester II\tCS 203\tSynthetic Tools Course\t4\tA',
  '2025-26 Semester I\tZZ 299\tSynthetic Project\t4\tP',
  '2024-25 Semester II\tZZ 104\tSynthetic Calculs\t2\tB',
  '2024-25 Semester II\tZZ 105\tSynthetic Failed Course\t4\tF',
  '2024-25 Semester I\tES 242(N)\tSynthetic Data Structures\t4\tA-',
  '2024-25 Semester I\tPE 101\tSynthetic Physical Education\t0\tP',
  'this footer line is not a course row',
].join('\n');

export async function signup(page: Page, username: string) {
  resetAccountThrottle();
  await page.goto('/signup');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/record\/import$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export async function login(page: Page, username: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export function semester(page: Page, label: string) {
  return page.getByRole('region', { name: label, exact: true });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}
