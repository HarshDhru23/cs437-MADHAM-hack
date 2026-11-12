import { expect, test, type Browser, type Page } from '@playwright/test';
import { createBlankPlan, expectNoHorizontalOverflow, IMS_TEXT, semester, signup, uniqueUser } from './helpers';

/**
 * The final usability pass on the real stack (CP-48, CP-49, CP-50): current courses are added by searching, everything that goes into a
 * semester is added from one box, and the plan and scenario pages show less at once, in larger type. Synthetic data only.
 */
test.describe.serial('final usability pass', () => {
  let page: Page;
  const DEVELOPER_TEXT = /\bD-\d\d\b|[A-Z]{3,}_[A-Z_]{3,}|revision \d|snapshot/;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  });

  test('sign up and import a record', async () => {
    await signup(page, uniqueUser('e2e_ux'));
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await page.getByLabel('IMS grade table').fill(IMS_TEXT);
    await page.getByRole('button', { name: 'Parse grades' }).click();
    await expect(page).toHaveURL(/\/record\/review\//);
    const unparsed = page.getByRole('region', { name: 'Lines that could not be read' });
    await unparsed.getByLabel(/Omit these lines/).check();
    await unparsed.getByLabel(/Reason/).fill('Footer text, not a course');
    await page.getByRole('button', { name: 'Confirm record' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
  });

  test('a current course is found by typing part of its title, added with one click, and put back with Undo (CP-48)', async () => {
    await page.goto('/record');
    const section = page.getByRole('region', { name: 'Current enrolment' });
    const box = section.getByRole('combobox', { name: /Find a course/ });
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.fill('oper');
    await section.getByRole('option', { name: /CS 330/ }).click();
    const table = section.getByRole('table', { name: 'Confirmed current courses' });
    await expect(table).toContainText('CS 330');
    await expect(section.getByText(/^\d+ of 28 credits$/)).toBeVisible();
    await expect(box).toHaveValue(''); // ready for the next course
    await expect(section.getByRole('status').first()).toContainText('Saved', { timeout: 15_000 });

    await section.getByRole('button', { name: 'Remove CS 330 from current enrolment' }).click();
    await expect(section.getByText('Removed CS 330.')).toBeVisible();
    await section.getByRole('button', { name: 'Undo' }).click();
    await expect(table).toContainText('CS 330');

    await box.fill('cs330'); // the same course, found by its code however it is spaced, now listed as added
    await expect(section.getByRole('option', { name: /CS 330/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(section).not.toContainText(DEVELOPER_TEXT);
  });

  test('every kind of addition to a semester is made from one box with the same ending (CP-49)', async () => {
    await createBlankPlan(page);
    const first = '2026–27 Semester I';
    await semester(page, first).getByRole('button', { name: `Add online course to ${first}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('tab')).toHaveText(['Course', 'Project', 'Online course', 'Placeholder']);
    await expect(dialog.getByRole('tab', { name: 'Online course', exact: true })).toHaveAttribute('aria-selected', 'true');
    const adds: Record<string, string> = { Course: 'Add course', Project: 'Add project course', 'Online course': 'Add online course', Placeholder: 'Add placeholder' };
    for (const [tab, add] of Object.entries(adds)) {
      await dialog.getByRole('tab', { name: tab, exact: true }).click();
      await expect(dialog.locator('[data-add-actions] button')).toHaveText([add, 'Cancel']);
    }

    // A project: the department from a button, the credits with plus, then add.
    await dialog.getByRole('tab', { name: 'Project' }).click();
    await dialog.getByRole('button', { name: 'CS', exact: true }).click();
    await dialog.getByRole('button', { name: 'More credits' }).click();
    await dialog.getByRole('button', { name: 'Add project course' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(semester(page, first)).toContainText('CS 299');
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');

    // An online course from the same box, outside the semester's limit.
    await semester(page, first).getByRole('button', { name: `Add online course to ${first}` }).click();
    await page.getByRole('dialog').getByLabel('Course name (optional)').fill('Machine Learning on NPTEL');
    await page.getByRole('dialog').getByRole('button', { name: 'Add online course', exact: true }).click();
    await expect(semester(page, first)).toContainText('Machine Learning on NPTEL');
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');
  });

  test('the plan page folds a semester away, keeps Move quiet until wanted, and sets text at 16 px (CP-50)', async () => {
    const first = '2026–27 Semester I';
    const second = '2026–27 Semester II';
    const sem = semester(page, second);
    await sem.getByRole('button', { name: `Hide ${second}` }).click();
    await expect(sem.getByRole('button', { name: `Add course to ${second}` })).toHaveCount(0);
    await expect(sem.getByRole('heading', { name: second })).toBeVisible();
    await sem.getByRole('button', { name: `Show ${second}` }).click();
    await expect(sem.getByRole('button', { name: `Add course to ${second}` })).toBeVisible();

    await page.getByRole('button', { name: 'Show only the current semester' }).click();
    await expect(semester(page, first).getByRole('button', { name: `Add course to ${first}` })).toBeVisible();
    await expect(sem.getByRole('button', { name: `Add course to ${second}` })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show every semester' }).click();

    const row = semester(page, first).getByRole('row').filter({ hasText: 'CS 299' });
    const move = row.locator('.pb-move');
    await expect.poll(() => move.evaluate((e) => getComputedStyle(e).opacity)).toBe('0'); // quiet until wanted
    await row.hover();
    await expect.poll(() => move.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    await expect(row.locator('select')).toBeVisible();

    const sizes = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontSize,
      lineHeight: Number.parseFloat(getComputedStyle(document.body).lineHeight) / Number.parseFloat(getComputedStyle(document.body).fontSize),
      h1: Number.parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),
      smallest: Math.min(...[...document.querySelectorAll('main *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())).map((e) => Number.parseFloat(getComputedStyle(e).fontSize))),
    }));
    expect(sizes.body).toBe('16px');
    expect(sizes.lineHeight).toBeGreaterThanOrEqual(1.6);
    expect(sizes.h1).toBeGreaterThanOrEqual(32);
    expect(sizes.smallest).toBeGreaterThanOrEqual(13);
    await expectNoHorizontalOverflow(page);
  });

  test('a scenario reads as three steps, with the full comparison one fold away (CP-50)', async () => {
    await page.goto('/scenarios');
    await page.getByLabel('Scenario name').fill('A lighter year');
    await page.getByRole('button', { name: 'Create scenario' }).click();
    await expect(page).toHaveURL(/\/scenarios\//);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['What would you change?', 'What happens', 'Keep it or drop it']);
    await expect(page.getByText('Full comparison')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(DEVELOPER_TEXT);

    await page.goto('/scenarios');
    await expect(page.getByRole('link', { name: 'A lighter year' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(DEVELOPER_TEXT);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
