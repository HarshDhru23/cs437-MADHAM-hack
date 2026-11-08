import { expect, test, type Browser, type Page } from '@playwright/test';
import { signup, uniqueUser } from './helpers';

/**
 * Flow 3 remainder and flow 7 on the real stack (CP-11, CP-29): a new import
 * replaces what the earlier import saved (changed grades are updated, missing
 * courses are removed) and never creates a duplicate attempt; a commit against a record that changed elsewhere is refused
 * (409) and leaves the saved record untouched. Synthetic rows only.
 */
const HEADER = 'Academic Period\tCourse No\tCourse Name\tCredit\tGrade';
const paste = (calculusGrade: string, ...extra: string[]) =>
  [HEADER, `2024-25 Semester II\tZZ 104\tSynthetic Calculus\t2\t${calculusGrade}`, '2024-25 Semester I\tZZ 101\tSynthetic Writing\t2\tA', ...extra].join('\n');

async function parseIms(page: Page, text: string) {
  await page.goto('/record/import');
  await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
  await page.getByLabel('IMS grade table').fill(text);
  await page.getByRole('button', { name: 'Parse grades' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
}

const calculusRow = (page: Page) => page.getByRole('region', { name: 'Academic history' }).getByRole('row', { name: /ZZ 104/ });

test.describe.serial('re-import conflicts', () => {
  let page: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  });

  test('importing again replaces the earlier import and never duplicates an attempt (CP-11)', async () => {
    await signup(page, uniqueUser('e2e_reimport'));
    await parseIms(page, paste('B'));
    await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm record' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();

    // The same transcript comes back with a revised grade: the new import replaces the earlier one, with no conflict to resolve.
    await parseIms(page, paste('A-'));
    await expect(page.getByText(/Compared with your saved record: 1 already saved, 1 updated/)).toBeVisible();
    await expect(page.getByTestId('reimport-replaces')).toContainText('replaces the courses saved from your earlier import');
    const confirm = page.getByRole('button', { name: 'Confirm record' });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();

    await page.goto('/record');
    await expect(page.getByRole('region', { name: 'Academic history' }).getByText('ZZ 104', { exact: true })).toHaveCount(1);
    await expect(calculusRow(page)).toContainText('A-');

    // A course the newer import no longer has is removed, and nothing is duplicated.
    await page.goto('/record/import');
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await page.getByLabel('IMS grade table').fill([HEADER, '2024-25 Semester II\tZZ 104\tSynthetic Calculus\t2\tA-'].join('\n'));
    await page.getByRole('button', { name: 'Parse grades' }).click();
    await expect(page.getByText(/1 already saved, 1 no longer in this import/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm record' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
    await page.goto('/record');
    await expect(page.getByRole('region', { name: 'Academic history' })).not.toContainText('ZZ 101');
    await expect(page.getByRole('region', { name: 'Academic history' }).getByText('ZZ 104', { exact: true })).toHaveCount(1);
    // The next test re-imports the original two rows against this record.
    await parseIms(page, paste('A-'));
    await page.getByRole('button', { name: 'Confirm record' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  });

  test('a commit against a record saved in another tab is refused and changes nothing (409)', async () => {
    await parseIms(page, paste('A-', '2025-26 Semester I\tZZ 201\tSynthetic Algorithms\t4\tA'));
    await expect(page.getByText(/Compared with your saved record: 1 new, 2 already saved/)).toBeVisible();

    // Another tab of the same account saves first, moving the record revision on.
    const other = await page.context().newPage();
    await other.goto('/record');
    const enrolment = other.getByRole('region', { name: 'Current enrolment' });
    const form = enrolment.getByRole('form', { name: 'Add current course' });
    await form.getByLabel('Course code').fill('ZZ 330');
    await form.getByLabel('Credits').fill('4');
    await form.getByLabel(/I confirm I am enrolled/).check();
    await form.getByRole('button', { name: 'Add to current enrolment' }).click();
    await expect(enrolment.getByRole('status')).toContainText('Saved');
    await other.close();

    await page.getByRole('button', { name: 'Confirm record' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Your record changed since this preview was created' });
    await expect(alert).toContainText('Your saved record was not changed');
    await expect(alert.getByRole('link', { name: 'Start a new import' })).toBeVisible();

    await page.goto('/record');
    await expect(page.getByRole('region', { name: 'Academic history' })).not.toContainText('ZZ 201');
    await expect(page.getByRole('region', { name: 'Current enrolment' })).toContainText('ZZ 330');
  });
});
