import { expect, test, type Locator, type Page } from '@playwright/test';
import { PASSWORD, expectNoHorizontalOverflow, resetAccountThrottle, semester, uniqueUser } from './helpers';

/**
 * CP-31 on the real stack: import, requirement inspection and planning on a 390px
 * phone, operated with the keyboard alone. Every control is reached with Tab (never
 * clicked or focused by script) and activated with Enter, Space or typing, so a control
 * that is missing from the tab order, or a screen that overflows the phone, fails here.
 */

const TAB_LIMIT = 400;

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let i = 0; i < TAB_LIMIT; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Not reachable with Tab within ${TAB_LIMIT} presses: ${target}`);
}

async function typeInto(page: Page, field: Locator, text: string) {
  await tabTo(page, field);
  await page.keyboard.type(text);
}

/** Clean synthetic rows: nothing unreadable, so the record can be confirmed straight away. */
const CLEAN_IMS = [
  'Academic Period\tCourse No\tCourse Name\tCredit\tGrade',
  '2025-26 Semester I\tZZ 201\tSynthetic Algorithms\t4\tA',
  '2024-25 Semester II\tZZ 104\tSynthetic Calculus\t2\tB',
].join('\n');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('a student imports, inspects a requirement and plans on a phone with the keyboard alone (CP-31)', async ({ page }) => {
  resetAccountThrottle();
  await page.goto('/signup');
  await expectNoHorizontalOverflow(page);
  await typeInto(page, page.getByLabel('Username'), uniqueUser('e2e_phone'));
  await typeInto(page, page.getByLabel('Password', { exact: true }), PASSWORD);
  await typeInto(page, page.getByLabel('Confirm password'), PASSWORD);
  await tabTo(page, page.getByRole('button', { name: 'Create account' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/record\/import$/);

  // Import: choose the paste tab with the arrow keys, paste, parse.
  await expectNoHorizontalOverflow(page);
  await tabTo(page, page.getByRole('tab', { name: 'Upload transcript PDF' }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Paste IMS grades' })).toHaveAttribute('aria-selected', 'true');
  const table = page.getByLabel('IMS grade table');
  await tabTo(page, table);
  await page.keyboard.insertText(CLEAN_IMS);
  await tabTo(page, page.getByRole('button', { name: 'Parse grades' }));
  await page.keyboard.press('Enter');

  // Review and confirm.
  await expect(page).toHaveURL(/\/record\/review\//);
  await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const confirm = page.getByRole('button', { name: 'Confirm record' });
  await expect(confirm).toBeEnabled();
  await tabTo(page, confirm);
  await page.keyboard.press('Enter');

  // Requirement inspection: open one requirement's details and read its counted courses and source.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('region', { name: 'Data context' })).toContainText('Your completed courses');
  await expectNoHorizontalOverflow(page);
  const details = page.getByRole('button', { name: /^Humanities and Social Sciences \(GE included\)\s*\d/ });
  await tabTo(page, details);
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator(`#${await details.getAttribute('aria-controls')}`);
  await expect(panel).toContainText('HS 191');
  await expect(panel).not.toContainText(/adv13|Sources:/);
  await expectNoHorizontalOverflow(page);

  // Planning: create a plan and add a course from the keyboard.
  await tabTo(page, page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plan', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/plan$/);
  await tabTo(page, page.getByRole('button', { name: 'Create a plan' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
  await expectNoHorizontalOverflow(page);
  await tabTo(page, semester(page, '2026–27 Semester I').getByRole('button', { name: 'Add course to 2026–27 Semester I' }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /Add course to 2026–27 Semester I/ });
  await typeInto(page, dialog.getByLabel('Course code'), 'ZZ 330');
  await typeInto(page, dialog.getByLabel(/Credits/), '4');
  await tabTo(page, dialog.getByRole('button', { name: 'Add course', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');
  await expect(semester(page, '2026–27 Semester I')).toContainText('ZZ 330');
  await expect(semester(page, '2026–27 Semester I')).toContainText(/Semester total: 4 \/ 28 credits/);   // Plan tab wording (F2-owned): semester total against the 28-credit limit
  await expectNoHorizontalOverflow(page);
});
