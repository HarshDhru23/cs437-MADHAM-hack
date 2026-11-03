import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expectNoHorizontalOverflow, IMS_TEXT, PASSWORD, semester, signup, uniqueUser } from './helpers';

/**
 * Flow 8 on the real stack (A11, CP-30, CP-32): backup download, data deletion
 * (wrong then right password), restore from the downloaded backup, the
 * printable report, account deletion and isolation from another account.
 * Uses two account actions (two sign-ups) of the 10-per-15-minutes throttle.
 */
const IMS_ROWS = IMS_TEXT.split('\n')
  .filter((line) => !line.startsWith('this footer'))
  .join('\n');

async function deleteData(page: Page, password: string, { account = false } = {}) {
  await page.goto('/account');
  await page.getByLabel('Current password for deletion').fill(password);
  await page.getByLabel(/^Type “delete my data” to confirm$/).fill('delete my data');
  if (account) await page.getByLabel('Delete my account too').check();
  await page.getByRole('button', { name: account ? 'Delete my data and account…' : 'Delete my data…' }).click();
  const dialog = page.getByRole('dialog', { name: account ? 'Delete your data and account now?' : 'Delete your data now?' });
  await dialog.getByRole('button', { name: account ? 'Delete data and account' : 'Delete my data', exact: true }).click();
}

test.describe.serial('account data: backup, restore, report and deletion', () => {
  const owner = uniqueUser('e2e_data');
  let page: Page;
  let backupPath = '';
  let restoredPlanUrl = '';

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  });

  test('sign up, import IMS grades and save a plan', async () => {
    await signup(page, owner);
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await page.getByLabel('IMS grade table').fill(IMS_ROWS);
    await page.getByRole('button', { name: 'Parse grades' }).click();
    await expect(page.getByText(/7 rows found in 4 terms/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm record' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();

    await page.goto('/plan');
    await page.getByRole('button', { name: 'Create a plan' }).click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
    await semester(page, '2026–27 Semester I').getByRole('button', { name: 'Add course to 2026–27 Semester I' }).click();
    const dialog = page.getByRole('dialog', { name: /Add course to 2026–27 Semester I/ });
    await dialog.getByLabel('Course code').fill('ZZ 330');
    await dialog.getByLabel(/Credits/).fill('4');
    await dialog.getByRole('button', { name: 'Add course', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');
  });

  test('download a backup: own username, attempts and plan, no password (CP-30)', async ({}, testInfo) => {
    await page.goto('/account');
    await expect(page.getByText(/not an official transcript or institute record/)).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup (JSON)' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^coursepath-backup-\d{4}-\d{2}-\d{2}\.json$/);
    backupPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(backupPath);
    await expect(page.getByRole('status').filter({ hasText: 'Saved coursepath-backup-' })).toBeVisible();

    const text = readFileSync(backupPath, 'utf-8');
    const backup = JSON.parse(text);
    expect(backup.schema_version).toBe('1');
    expect(backup.data.kind).toBe('coursepath-backup');
    expect(backup.data.account.username).toBe(owner);
    expect(backup.data.record.attempts).toHaveLength(7);
    expect(backup.data.record.attempts.map((a: { normalized_code: string }) => a.normalized_code)).toContain('ES 242(N)');
    expect(backup.data.plans).toHaveLength(1);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/password|csrf|sessionid/i);
  });

  test('deleting with a wrong password deletes nothing; the right password empties the record (CP-32)', async () => {
    await deleteData(page, 'Wrong-synthetic-pass-1');
    await expect(page.getByRole('alert').filter({ hasText: 'Your current password was not accepted. Nothing was deleted.' })).toContainText('REAUTH_FAILED');
    await page.goto('/record');
    await expect(page.getByRole('region', { name: 'Academic history' })).toContainText('ES 242(N)');

    await deleteData(page, PASSWORD);
    const done = page.getByRole('status').filter({ hasText: 'Your data was deleted.' });
    await expect(done).toBeVisible();
    await expect(done.getByRole('list', { name: 'Deleted items' })).toContainText('Attempts: 7');
    await expect(done.getByRole('list', { name: 'Deleted items' })).toContainText('Plans: 1');
    await expect(done).toContainText('Retention:');
    await page.goto('/record');
    await expect(page.getByText('No accepted attempts yet.')).toBeVisible();
    await page.goto('/plan');
    await expect(page.getByText('You have no saved plans yet.')).toBeVisible();
  });

  test('restore from the downloaded backup: the server diff, an explicit confirmation, the record is back (CP-30)', async () => {
    await page.goto('/account');
    await page.getByLabel('Backup file (.json)').setInputFiles(backupPath);
    await page.getByRole('button', { name: 'Preview restore' }).click();
    const preview = page.getByRole('region', { name: 'Restore preview' });
    await expect(preview).toBeVisible();
    const row = (label: string) => preview.locator('dt', { hasText: label }).locator('xpath=..');
    await expect(row('Attempts added')).toContainText('7');
    await expect(row('Attempts added')).toContainText('ES 242(N)');
    await expect(row('Attempts removed')).toContainText('0');
    await expect(row('Plans to create')).toContainText('1');
    await expect(row('Scenarios not restored')).toContainText('0');

    await preview.getByRole('button', { name: 'Restore this backup…' }).click();
    await page.getByRole('dialog', { name: 'Replace your saved record?' }).getByRole('button', { name: 'Replace record and restore' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Backup restored.' })).toContainText('with 7 attempts; 1 plan was added.');

    await page.goto('/record');
    await expect(page.getByRole('region', { name: 'Academic history' }).getByText('ZZ 299', { exact: true })).toHaveCount(2);
    await page.goto('/plan');
    await page.getByRole('link', { name: 'My plan' }).click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
    restoredPlanUrl = page.url();
    await expect(semester(page, '2026–27 Semester I')).toContainText('ZZ 330');
  });

  test('the printable report shows rules, the three views, semesters and its limits (CP-30)', async () => {
    await page.getByRole('link', { name: 'Printable report' }).click();
    await expect(page).toHaveURL(/\/report\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Printable report' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('Not an official institute approval.');
    await expect(page.getByRole('region', { name: 'Rules and sources' })).toContainText('Rule version');
    for (const view of ['Actual completed history', 'Completed + confirmed current enrolment', 'Projected with this plan'])
      await expect(page.getByRole('table', { name: view })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Actual completed history' })).toContainText('ES 242(N)');
    await expect(page.getByRole('region', { name: 'Planned semesters' })).toContainText('ZZ 330');
    await expect(page.getByRole('region', { name: 'Scenario assumptions' })).toContainText('None.');
    await expect(page.getByRole('region', { name: 'Unresolved issues' })).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await expect(page.getByRole('note')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();

    // Phone width: the report and the account page never scroll sideways.
    const reportUrl = page.url();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Delete my data' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(new URL(reportUrl).pathname);
    await expect(page.getByRole('heading', { level: 1, name: 'Printable report' })).toBeVisible();
  });

  test('deleting the account signs out and returns to the public requirements (CP-32)', async () => {
    await deleteData(page, PASSWORD, { account: true });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('status').filter({ hasText: 'Your CoursePath account and its data were deleted' })).toContainText('Attempts: 7');
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Data context' })).toContainText('Public requirements (no personal data)');
    await expect(page.getByText(owner)).toHaveCount(0);
    await page.goto('/record');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in required' })).toBeVisible();
  });

  test('another account never sees the first account\'s data or restores its backup (CP-32)', async ({ browser }) => {
    const other = await (await browser.newContext()).newPage();
    await signup(other, uniqueUser('e2e_data_other'));
    await other.goto('/record');
    await expect(other.getByText('No accepted attempts yet.')).toBeVisible();
    await other.goto(new URL(restoredPlanUrl).pathname);
    await expect(other.getByText('Plan not found')).toBeVisible();
    await other.goto(new URL(restoredPlanUrl).pathname.replace('/plan/', '/report/'));
    await expect(other.getByText('Plan not found')).toBeVisible();
    await expect(other.getByRole('table')).toHaveCount(0);

    await other.goto('/account');
    await other.getByLabel('Backup file (.json)').setInputFiles(backupPath);
    await other.getByRole('button', { name: 'Preview restore' }).click();
    await expect(other.getByRole('alert').filter({ hasText: 'This backup cannot be restored. Your saved record was not changed.' })).toContainText('BACKUP_OWNER_MISMATCH');
    await other.goto('/record');
    await expect(other.getByText('No accepted attempts yet.')).toBeVisible();
    await other.close();
  });
});
