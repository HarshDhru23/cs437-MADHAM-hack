import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, IMS_TEXT, semester, signup, uniqueUser } from './helpers';

/**
 * Flow 4 (A08, CP-23/24) on the real stack, against the committed official
 * 2026-27 Semester I timetable (data/offerings/2026-27-I.json: reviewed,
 * complete, D-22). Expected slots are the ones in docs/team/source-findings.md
 * (B1 Tuesday 08:30-09:50, B2 Friday 08:30-09:50, H2 Wednesday 11:30-12:50);
 * the cells and rooms are that file's source rows (PH 202 K31/L31, ES 667 K250,
 * CS 331 K112/L112). Its meetings are dated to the term's classes, so the
 * server reports these clashes as certain.
 */
test.describe.serial('timetable clashes', () => {
  let page: Page;
  const timetable = (label: string) => page.getByRole('region', { name: `Timetable check for ${label}`, exact: true });

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  });

  async function addCourse(label: string, code: string) {
    await semester(page, label).getByRole('button', { name: `Add course to ${label}` }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`Add course to ${label}`) });
    await dialog.getByLabel('Course code').fill(code);
    await dialog.getByLabel(/Credits/).fill('4');
    await dialog.getByRole('button', { name: 'Add course', exact: true }).click();
    await expect(semester(page, label)).toContainText(code);
  }

  test('sign up, import IMS grades and create a plan', async () => {
    await signup(page, uniqueUser('e2e_clash'));
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
    await page.getByRole('button', { name: 'Create a plan' }).click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
    await expect(semester(page, '2026–27 Semester I')).toContainText('Current term');
  });

  test('PH 202 and ES 667 clash on their Tuesday and Friday lectures, with source cells (CP-24)', async () => {
    const label = '2026–27 Semester I';
    await addCourse(label, 'PH 202');
    await addCourse(label, 'ES 667');
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');

    const panel = timetable(label);
    await expect(panel.getByRole('heading', { name: /Clashes reported by the server/ })).toBeVisible();
    await expect(panel).toContainText('Clash check: ✕Clashes');
    // Snapshot facts (CP-23): reviewed and complete, still not a registration guarantee.
    await expect(panel).toContainText('timetable-2026-27-I');
    await expect(panel).toContainText('Reviewed against its source by staff');
    await expect(panel).toContainText(/Coverage\s*Complete/);
    await expect(panel).toContainText('not a registration guarantee');
    await expect(panel.getByRole('row', { name: /PH 202/ })).toContainText('Confirmed in snapshot');

    const clashes = panel.locator('li[data-severity]');
    const tuesday = clashes.filter({ hasText: 'overlap on Tuesday 08:30–09:50' });
    const friday = clashes.filter({ hasText: 'overlap on Friday 08:30–09:50' });
    for (const clash of [tuesday, friday]) {
      await expect(clash).toHaveCount(1);
      await expect(clash).toContainText(/PH 202\s*lecture and\s*ES 667\s*lecture/);
      await expect(clash).toContainText('Time table!K31');
      await expect(clash).toContainText('Time table!K250');
      // Dated, required meetings: a certain clash, not a possible one.
      await expect(clash).toContainText('Clash');
      await expect(clash).not.toContainText('Possible clash');
      await expect(clash).toHaveAttribute('data-severity', 'error');
    }
    await expect(panel).toContainText('Different rooms do not resolve a clash');

    // The weekly detail supplements the list and has a text form.
    await panel.getByText('Weekly detail for 2026–27 Semester I').click();
    await expect(panel.getByRole('list', { name: 'Weekly meetings for 2026–27 Semester I (list)' })).toContainText('PH 202 lecture, slot B1 (required; room 7/206) — in a reported clash');

    // The section picker shows the required lecture and tutorial meetings.
    await panel.getByRole('button', { name: 'Choose sections for PH 202' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sections for PH 202 in 2026–27 Semester I' });
    await expect(dialog.getByRole('region', { name: 'PH 202 tutorial meetings' })).toContainText('Wednesday 11:30–12:50');
    await expect(dialog.getByRole('region', { name: 'PH 202 lecture meetings' })).toContainText('All listed meetings required');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('PH 202 and CS 331 clash on the Wednesday H2 tutorial even though their lectures differ (CP-24)', async () => {
    const label = '2026–27 Semester I';
    await semester(page, label).getByRole('button', { name: 'Remove ES 667' }).click();
    await addCourse(label, 'CS 331');
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');
    const clashes = timetable(label).locator('li[data-severity]');
    await expect(clashes.filter({ hasText: 'overlap on Wednesday 11:30–12:50' })).toContainText(/PH 202\s*tutorial and\s*CS 331\s*tutorial/);
    await expect(clashes).toHaveCount(1);
    await expect(timetable(label)).not.toContainText('overlap on Tuesday');
  });

  test('a course in a later term with no timetable is "Not checked", never clear (CP-23/24)', async () => {
    // No 2027-28 timetable is published; CS 329 is in the 2026-27 Semester I one (K64), so D-23 gives only a historical hint.
    const label = '2027–28 Semester I';
    await addCourse(label, 'CS 329');
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');
    const panel = timetable(label);
    await expect(panel.getByRole('note', { name: `Why ${label} is not checked` })).toContainText(`No timetable snapshot is stored for ${label}`);
    await expect(panel).toContainText('Clash check: ?Not checked');
    await expect(panel).not.toContainText('No clashes found');
    await expect(panel.getByRole('row', { name: /CS 329/ })).toContainText('Historical hint');
    await expect(panel.getByRole('row', { name: /CS 329/ })).not.toContainText('Confirmed in snapshot');
    // The 2026-27 Semester I snapshot's meetings are not reused for this term.
    await expect(panel).not.toContainText('timetable-2026-27-I');
  });

  test('the planner and timetable panel fit a 390px phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(timetable('2026–27 Semester I')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
