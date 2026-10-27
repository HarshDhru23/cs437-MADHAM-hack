import { expect, test } from '@playwright/test';
import { SYNTHETIC_PDF } from '../global-setup';
import { signup, uniqueUser } from './helpers';

// Flow 3 (CP-06/11/12): supported-layout synthetic PDF -> all semester rows ->
// source totals -> re-import without duplicates.
test('PDF import shows every semester and source totals; re-import is idempotent', async ({ page }) => {
  await signup(page, uniqueUser('e2e_pdf'));
  await page.getByRole('tab', { name: 'Upload transcript PDF' }).click();
  await page.getByLabel('Choose transcript PDF').setInputFiles(SYNTHETIC_PDF);
  await expect(page.getByText('Selected: synthetic-transcript.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Parse transcript' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
  await expect(page.getByText(/8 rows found in 4 terms/)).toBeVisible();
  for (const term of ['2024–25 Semester I', '2024–25 Semester II', '2025–26 Semester I', '2025–26 Semester II']) {
    await expect(page.getByRole('table', { name: term, exact: true })).toBeVisible();
  }
  const totals = page.getByRole('table', { name: 'Totals: source-reported vs extracted' });
  await expect(totals.getByRole('row', { name: /Earned credits/ })).toContainText('16');
  await expect(totals.getByRole('row', { name: /Credits \(raw sum of rows\)/ })).toContainText('16');
  await page.getByRole('button', { name: /Source for ES 242\(N\)/ }).first().click();
  await expect(page.getByRole('dialog', { name: /Source for ES 242\(N\)/ })).toContainText('Page 1');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Confirm record' }).click();
  await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Overview' })).toContainText('Earned credits');

  // Re-import the same file: every row is unchanged and nothing is duplicated.
  await page.goto('/record/import');
  await page.getByLabel('Choose transcript PDF').setInputFiles(SYNTHETIC_PDF);
  await page.getByRole('button', { name: 'Parse transcript' }).click();
  await expect(page.getByText(/0 new, 8 unchanged, 0 conflicting/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm record' }).click();
  await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  await page.goto('/record');
  await expect(page.getByRole('region', { name: 'Academic history' }).getByText('ES 242(N)', { exact: true })).toHaveCount(4);
});

test('an unreadable file keeps the prior record and offers alternatives (CP-09)', async ({ page }) => {
  await signup(page, uniqueUser('e2e_bad'));
  await page.getByLabel('Choose transcript PDF').setInputFiles({ name: 'not-really.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await page.getByRole('button', { name: 'Parse transcript' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Your saved record was not changed' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Paste IMS grades instead' })).toBeVisible();
});
