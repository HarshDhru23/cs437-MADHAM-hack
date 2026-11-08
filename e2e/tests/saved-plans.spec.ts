import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, IMS_TEXT, semester, signup, uniqueUser, createBlankPlan } from './helpers';

/**
 * Saved plans on the real stack: create, edit, come back, delete (from the list and from the plan's own page), and a phone-width layout.
 * Synthetic data only. Everything a student reads is checked for developer text on the way.
 */
test.describe.serial('saved plans', () => {
  let page: Page;
  const DEVELOPER_TEXT = /CoursePath team|D-\d\d|[A-Z]{3,}_[A-Z_]{3,}|snapshot|revision \d|standing|20-24/;
  const errors: string[] = [];

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
  });

  test('sign up, import and create a first plan', async () => {
    await signup(page, uniqueUser('e2e_plans'));
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await page.getByLabel('IMS grade table').fill(IMS_TEXT);
    await page.getByRole('button', { name: 'Parse grades' }).click();
    await expect(page).toHaveURL(/\/record\/review\//);
    const unparsed = page.getByRole('region', { name: 'Lines that could not be read' });
    await unparsed.getByLabel(/Omit these lines/).check();
    await unparsed.getByLabel(/Reason/).fill('Footer text, not a course');
    await page.getByRole('button', { name: 'Confirm record' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
    await page.goto('/plan');
    await expect(page.getByText('You have no saved plans yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete plan/ })).toHaveCount(0); // nothing to delete yet
    await expect(page.getByRole('button', { name: /Create (a|another) plan/ })).toHaveCount(0); // plans start from Generate plan, never as an empty "My plan"
    await createBlankPlan(page);
  });

  test('edits are saved, and coming back to the plan keeps them and keeps saving without a conflict', async () => {
    const first = '2026–27 Semester I';
    await semester(page, first).getByRole('button', { name: `Add course to ${first}` }).click();
    let dialog = page.getByRole('dialog', { name: new RegExp(`Add course to ${first}`) });
    await dialog.getByLabel('Course code').fill('ZZ 421');
    await dialog.getByLabel(/Credits/).fill('4');
    await dialog.getByRole('button', { name: 'Add course', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');

    await page.getByRole('link', { name: 'Plans', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
    await page.getByRole('link', { name: 'My plan', exact: true }).click();
    await expect(semester(page, first)).toContainText('ZZ 421');

    await semester(page, first).getByRole('button', { name: `Add placeholder to ${first}` }).click();
    dialog = page.getByRole('dialog', { name: /Add placeholder/ });
    await dialog.getByLabel('Target credits').fill('4');
    await dialog.getByLabel('Label').fill('An elective with a rather long label to check the phone layout does not scroll sideways');
    await dialog.getByRole('button', { name: 'Add placeholder', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved'); // no 409 from an older cached copy
    await expect(page.getByText(/Saved elsewhere|Conflict/)).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(DEVELOPER_TEXT);
  });

  test('the plan page fits a 390px phone without sideways scrolling', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(semester(page, '2026–27 Semester I')).toContainText('ZZ 421');
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: /^Delete plan/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: /^Delete plan/ })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('each saved plan says Valid or Not valid beside its name, and the list deletes one plan after asking', async () => {
    await createBlankPlan(page, 'My plan 2');
    await page.goto('/plan');
    const list = page.getByRole('list', { name: 'Your saved plans' });
    await expect(list.getByRole('listitem').filter({ hasText: 'My plan 2' })).toContainText('Not valid'); // an empty plan covers none of the degree
    await expect(list.getByRole('link', { name: 'My plan', exact: true })).toBeVisible();
    await expect(list.getByRole('link', { name: 'My plan 2', exact: true })).toBeVisible();

    await list.getByRole('button', { name: 'Delete plan My plan 2' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this plan?' });
    await expect(dialog).toContainText('“My plan 2” will be deleted and cannot be undone.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(list.getByRole('link', { name: 'My plan 2', exact: true })).toBeVisible(); // cancelling deletes nothing

    await list.getByRole('button', { name: 'Delete plan My plan 2' }).click();
    await page.getByRole('dialog', { name: 'Delete this plan?' }).getByRole('button', { name: 'Delete plan' }).click();
    await expect(page.getByText('Deleted “My plan 2”.')).toBeVisible();
    await expect(list.getByRole('link', { name: 'My plan 2', exact: true })).toHaveCount(0);
    await expect(list.getByRole('link', { name: 'My plan', exact: true })).toBeVisible();
  });

  test('deleting from the plan page returns to the list, and the deleted plan stays gone after a reload', async () => {
    await page.getByRole('link', { name: 'My plan', exact: true }).click();
    const url = page.url();
    await page.getByRole('button', { name: 'Delete plan My plan' }).click();
    await page.getByRole('dialog', { name: 'Delete this plan?' }).getByRole('button', { name: 'Delete plan' }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByText('Deleted “My plan”.')).toBeVisible();
    await expect(page.getByText('You have no saved plans yet.')).toBeVisible();
    await page.goto(url);
    await expect(page.getByText('Plan not found')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Your plans' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Plan not found')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
