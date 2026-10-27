import { expect, test, type Browser, type Page } from '@playwright/test';
import { login, semester, signup, uniqueUser } from './helpers';

/**
 * Flow 7 (offline save) and the A04 record part of flow 2 on the real stack:
 * an offline edit stays a visible unsaved draft until an explicit retry, and
 * confirmed current enrolment saved on one device is what another device loads.
 */
test.describe.serial('save states across devices', () => {
  const owner = uniqueUser('e2e_save');
  let page: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  });

  test('an offline plan edit is kept as an unsaved draft and saved on retry (CP-29)', async () => {
    await signup(page, owner);
    await page.goto('/plan');
    await page.getByRole('button', { name: 'Create a plan' }).click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
    const first = semester(page, '2024–25 Semester I');
    await expect(first).toBeVisible();
    const status = page.getByRole('status', { name: 'Plan save status' });

    await page.context().setOffline(true);
    await first.getByRole('button', { name: 'Add course to 2024–25 Semester I' }).click();
    const dialog = page.getByRole('dialog', { name: /Add course to 2024–25 Semester I/ });
    await dialog.getByLabel('Course code').fill('ZZ 330');
    await dialog.getByLabel(/Credits/).fill('4');
    await dialog.getByRole('button', { name: 'Add course', exact: true }).click();
    await expect(status).toContainText('Offline');
    await expect(page.getByRole('alert').filter({ hasText: 'You appear to be offline' })).toBeVisible();
    await expect(first).toContainText('ZZ 330');

    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Retry save' }).click();
    await expect(status).toContainText('Saved');
    await expect(status).toContainText('Server revision 1');
    await page.reload();
    await expect(semester(page, '2024–25 Semester I')).toContainText('ZZ 330');
  });

  test('current enrolment confirmed on one device is loaded on another with the same revision (A04, CP-29)', async ({ browser }) => {
    await page.goto('/record');
    const enrolment = page.getByRole('region', { name: 'Current enrolment' });
    const form = enrolment.getByRole('form', { name: 'Add current course' });
    await form.getByLabel('Course code').fill('ZZ 331');
    await form.getByLabel('Credits').fill('4');
    await form.getByLabel('Term', { exact: true }).fill('2026-27-I');
    await form.getByLabel(/Sections/).fill('L1, T2');
    await form.getByLabel(/I confirm I am enrolled/).check();
    await form.getByRole('button', { name: 'Add to current enrolment' }).click();
    await expect(enrolment.getByRole('status')).toContainText('Saved');
    const revision = (await enrolment.getByRole('status').innerText()).match(/Server revision (\d+)/)?.[1];
    expect(revision).toBeTruthy();

    const other = await (await browser.newContext()).newPage();
    await login(other, owner, '/record');
    const remote = other.getByRole('region', { name: 'Current enrolment' });
    const row = remote.getByRole('row', { name: /ZZ 331/ });
    await expect(row).toContainText('2026–27 Semester I');
    await expect(row).toContainText('L1, T2');
    await expect(other.getByText('Record revision', { exact: true }).locator('..')).toContainText(revision!);
    await expect(other.getByRole('region', { name: 'Data context' })).toContainText(`Record revision:${revision}`);
    await other.close();
  });
});
