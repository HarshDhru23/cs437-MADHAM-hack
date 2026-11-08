import { expect, test, type Browser, type Page } from '@playwright/test';
import { SYNTHETIC_PDF } from '../global-setup';
import { signup, uniqueUser } from './helpers';

// Flow 3 (CP-06/11/12): supported-layout synthetic PDF -> all semester rows ->
// source totals -> re-import without duplicates. Both tests share one account,
// so the unreadable file is tried against a saved record (and the suite stays
// inside the 10-account-actions throttle).
test.describe.configure({ mode: 'serial' });
let page: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
});

test.afterAll(async () => {
  await page.context().close();
});

test('PDF import shows every semester and source totals; re-import is idempotent', async () => {
  await signup(page, uniqueUser('e2e_pdf'));
  await page.getByRole('tab', { name: 'Upload transcript PDF' }).click();
  await page.getByLabel('Choose transcript PDF').setInputFiles(SYNTHETIC_PDF);
  await expect(page.getByText('Selected: synthetic-transcript.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Parse transcript' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
  await expect(page.getByText(/rows found/)).toHaveCount(0);   // row counts are not shown
  for (const term of ['2024–25 Semester I', '2024–25 Semester II', '2025–26 Semester I', '2025–26 Semester II']) {
    await expect(page.getByRole('table', { name: term, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('table', { name: /Totals/ })).toHaveCount(0);   // no reconciliation table
  await expect(page.getByRole('button', { name: /^Source for/ })).toHaveCount(0);   // no source viewer
  await page.getByRole('button', { name: 'Confirm record' }).click();
  await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Overview' })).toContainText('Credits counted');

  // Re-import the same file: every row is unchanged and nothing is duplicated.
  await page.goto('/record/import');
  await page.getByLabel('Choose transcript PDF').setInputFiles(SYNTHETIC_PDF);
  await page.getByRole('button', { name: 'Parse transcript' }).click();
  await expect(page.getByText(/Compared with your saved record: 8 already saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm record' }).click();
  await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  await page.goto('/record');
  await expect(page.getByRole('region', { name: 'Academic history' }).getByText('ES 242(N)', { exact: true })).toHaveCount(4);
});

test('an unreadable file keeps the prior record and offers alternatives (CP-09)', async () => {
  await page.goto('/record/import');
  await page.getByLabel('Choose transcript PDF').setInputFiles({ name: 'not-really.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByRole('button', { name: 'Parse transcript' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Your saved record was not changed' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Paste IMS grades instead' })).toBeVisible();
  await page.goto('/record');
  await expect(page.getByRole('region', { name: 'Academic history' }).getByText('ES 242(N)', { exact: true })).toHaveCount(4);
});
