import { expect, test, type Browser, type Page } from '@playwright/test';
import { IMS_TEXT, login, semester, signup, uniqueUser } from './helpers';

/**
 * Flows 2, 7 and 8 on the real stack: new account -> IMS paste -> review and
 * correct -> confirm -> actual audit -> plan add/move -> save -> second
 * browser context; then 409 conflict, expired session and account isolation.
 */
test.describe.serial('student flow', () => {
  const owner = uniqueUser('e2e_owner');
  let planUrl = '';
  let pageA: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    pageA = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  });

  test('sign up, paste IMS grades, review, correct and confirm (CP-07/08/12/13)', async () => {
    const page = pageA;
    await signup(page, owner);
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await page.getByLabel('IMS grade table').fill(IMS_TEXT);
    await page.getByRole('button', { name: 'Parse grades' }).click();

    await expect(page).toHaveURL(/\/record\/review\//);
    await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
    await expect(page.getByText(/7 rows found in 4 terms/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lines that could not be read' })).toContainText('this footer line is not a course row');
    // Equivalence evidence stays visible; nothing offers to approve it.
    await expect(page.getByText(/no equivalence is approved/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0);

    const confirm = page.getByRole('button', { name: 'Confirm record' });
    await expect(confirm).toBeDisabled();

    // Correct a transcription error with a justification.
    await page.getByRole('button', { name: 'Edit ZZ 104' }).click();
    const editor = page.getByRole('group', { name: 'Edit ZZ 104' });
    await editor.getByLabel('Title').fill('Synthetic Calculus');
    await editor.getByLabel(/Justification/).fill('Checked the synthetic source table');
    await editor.getByRole('button', { name: 'Apply correction' }).click();
    await expect(page.locator('tr[data-changed="true"]')).toContainText('Synthetic Calculus');

    const unparsed = page.getByRole('region', { name: 'Lines that could not be read' });
    await unparsed.getByLabel(/Omit these lines/).check();
    await unparsed.getByLabel(/Reason/).fill('Footer text, not a course');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Lands on the real audit for the new record revision.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Data context' })).toContainText('Actual completed history');
    await expect(page.getByRole('region', { name: 'Attempts not counted' })).toContainText('ZZ 105');
    await expect(page.getByRole('region', { name: 'Unresolved decisions and issues' })).toBeVisible();
    // Expected from the reviewed rule data, not from the app: CS 202 is a mandatory core course (ADV13 p. 14) and
    // CS 203 does not satisfy it (D-03), so "tools" can never be satisfied; most core courses are absent, so no completion.
    await expect(page.getByRole('region', { name: 'Overview' }).getByText('Overall verdict').locator('..')).toContainText('Not complete');
    const toolsHeading = page.getByRole('list', { name: 'Requirements' }).getByRole('heading', { name: 'Software Tools and Techniques for CSE', exact: true });
    const tools = toolsHeading.locator('xpath=ancestor::li[1]');
    await expect(tools).toContainText('CS 202');
    await expect(tools).not.toContainText('Satisfied');
  });

  test('accepted record keeps repeats, failed attempts and the correction (CP-02/10)', async () => {
    const page = pageA;
    await page.getByRole('link', { name: 'My record', exact: true }).click();
    const history = page.getByRole('region', { name: 'Academic history' });
    await expect(history.getByText('ZZ 299', { exact: true })).toHaveCount(2);
    await expect(history).toContainText('ES 242(N)');
    await expect(history).toContainText('Failed / not completed');
    await expect(history).toContainText('Corrected (1)');
    await history.getByRole('button', { name: /Source for ZZ 104/ }).click();
    await expect(page.getByRole('dialog', { name: 'Source for ZZ 104' })).toContainText('Synthetic Calculs');
    await page.keyboard.press('Escape');
  });

  test('performance shows server values and reasons (CP-15/16)', async () => {
    const page = pageA;
    await page.goto('/performance');
    const cpi = page.getByRole('region', { name: 'Cumulative CPI' });
    await expect(cpi).toBeVisible();
    // Independent arithmetic on IMS_TEXT with the roadmap points (A 10, A- 9, B 8, F 0; P excluded):
    // ZZ 299 A 4x10 + CS 203 A 4x10 + ZZ 104 B 2x8 + ZZ 105 F 4x0 + ES 242(N) A- 4x9 = 132 over 18 credits.
    // The draft backend has no official rounding policy, so the displayed CPI must be Unavailable, never 0.
    const value = (label: string | RegExp) => cpi.getByText(label, { exact: typeof label === 'string' }).locator('xpath=following-sibling::dd[1]');
    await expect(value('CPI (server)')).toContainText('Unavailable');
    await expect(value('CPI (server)')).not.toHaveText(/^0(\.0+)?\b/);
    await expect(value('Grade points')).toHaveText('132');
    await expect(value(/Performance credits \(denominator\)/)).toHaveText('18');
    // 2025-26 Semester I has only a P attempt: no denominator, so its SPI is unavailable rather than 0.
    const spi = page.getByRole('table', { name: 'Term SPI' });
    await expect(spi).toContainText('2024–25 Semester I');
    await expect(spi.getByRole('row', { name: /2025–26 Semester I\b/ }).first()).toContainText('Unavailable');
  });

  test('create a plan, add and move a course with the keyboard, see server totals (CP-04/05)', async () => {
    const page = pageA;
    await page.goto('/plan');
    await page.getByRole('button', { name: 'Create a plan' }).click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
    planUrl = page.url();
    for (const term of ['2026–27 Semester I', '2026–27 Semester II', '2027–28 Semester I', '2027–28 Semester II']) await expect(semester(page, term)).toBeVisible();
    await expect(semester(page, '2026–27 Semester I')).toContainText('Current term');

    await semester(page, '2026–27 Semester I').getByRole('button', { name: 'Add course to 2026–27 Semester I' }).click();
    const dialog = page.getByRole('dialog', { name: /Add course to 2026–27 Semester I/ });
    await dialog.getByLabel('Course code').fill('ZZ 330');
    await dialog.getByLabel(/Credits/).fill('4');
    await dialog.getByRole('button', { name: 'Add course', exact: true }).click();
    const status = page.getByRole('status', { name: 'Plan save status' });
    await expect(status).toContainText('Saved');
    await expect(semester(page, '2026–27 Semester I')).toContainText('Selected courses: 4 credits');
    await expect(semester(page, '2026–27 Semester I')).toContainText('Not checked');

    // Keyboard-only move.
    const select = semester(page, '2026–27 Semester I').getByLabel('Move ZZ 330 to');
    await select.focus();
    await select.selectOption('2026-27-II');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Move ZZ 330', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(semester(page, '2026–27 Semester II')).toContainText('ZZ 330');
    await expect(status).toContainText('Saved');
    await expect(semester(page, '2026–27 Semester II')).toContainText('Selected courses: 4 credits');
    await expect(page.getByRole('region', { name: 'Plan validation' })).toContainText(/Prerequisite data is unknown|PREREQUISITE_UNKNOWN/);
  });

  test('a second browser context sees the acknowledged save; a stale edit gets a 409 (CP-29)', async ({ browser }) => {
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await login(pageB, owner, new URL(planUrl).pathname);
    await expect(semester(pageB, '2026–27 Semester II')).toContainText('ZZ 330');
    await expect(pageB.getByRole('status', { name: 'Plan save status' })).toContainText('Server revision 2');

    // B saves a change; A is now stale.
    await semester(pageB, '2026–27 Semester II').getByRole('button', { name: 'Remove ZZ 330' }).click();
    await expect(pageB.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');

    await semester(pageA, '2027–28 Semester I').getByRole('button', { name: 'Add course to 2027–28 Semester I' }).click();
    const dialog = pageA.getByRole('dialog', { name: /Add course to 2027–28 Semester I/ });
    await dialog.getByLabel('Course code').fill('ZZ 421');
    await dialog.getByLabel(/Credits/).fill('4');
    await dialog.getByRole('button', { name: 'Add course', exact: true }).click();
    await expect(pageA.getByRole('status', { name: 'Plan save status' })).toContainText('Conflict');
    await expect(semester(pageA, '2027–28 Semester I')).toContainText('ZZ 421'); // draft kept
    await pageA.getByRole('button', { name: 'Compare with saved version' }).click();
    await expect(pageA.getByRole('alert').filter({ hasText: 'This was saved elsewhere' })).toContainText('Saved version');
    await pageA.getByRole('button', { name: 'Reload saved version' }).click();
    await expect(semester(pageA, '2027–28 Semester I')).not.toContainText('ZZ 421');
    await expect(semester(pageA, '2026–27 Semester II')).not.toContainText('ZZ 330');
    await contextB.close();
  });

  test('an expired session keeps the unsaved import draft through sign-in', async () => {
    const page = pageA;
    await page.goto('/record/import');
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await page.getByLabel('IMS grade table').fill('Academic Period\tCourse No\tCourse Name\tCredit\tGrade\n2025-26 Semester II\tZZ 401\tSynthetic Pending\t4\tB');
    await page.context().clearCookies();
    await page.getByRole('button', { name: 'Parse grades' }).click();
    await expect(page.getByText('Your session ended.')).toBeVisible();
    await page.getByRole('link', { name: 'Sign in again' }).click();
    await page.getByLabel('Username').fill(owner);
    await page.getByLabel('Password', { exact: true }).fill('Synthetic-pass-9183!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/record\/import$/);
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await expect(page.getByLabel('IMS grade table')).toHaveValue(/ZZ 401/);
  });

  test('another account cannot see the first account\'s plan; sign-out clears personal state (CP-32 foundation)', async ({ browser }) => {
    const other = await (await browser.newContext()).newPage();
    await signup(other, uniqueUser('e2e_other'));
    await other.goto(new URL(planUrl).pathname);
    await expect(other.getByText('Plan not found')).toBeVisible();
    // A malformed id never reaches an API view (Django answers with an HTML 404); it is still "not found".
    await other.goto('/plan/not-a-plan-id');
    await expect(other.getByText('Plan not found')).toBeVisible();
    await other.goto('/record');
    await expect(other.getByRole('region', { name: 'Academic history' })).not.toContainText('ZZ 299');
    await other.close();

    // Sign out in the same tab, then use the public page without reloading: nothing personal may remain.
    await pageA.getByRole('link', { name: 'Requirements', exact: true }).click();
    await expect(pageA.getByRole('region', { name: 'Overview' })).toBeVisible();
    await pageA.getByRole('button', { name: 'Sign out' }).click();
    await expect(pageA.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await expect(pageA.getByRole('heading', { level: 1, name: 'CSE 2024 graduation requirements' })).toBeVisible();
    await expect(pageA.getByRole('region', { name: 'Overview' })).toHaveCount(0);
    await expect(pageA.getByRole('region', { name: 'Attempts not counted' })).toHaveCount(0);
    await expect(pageA.getByRole('region', { name: 'Data context' })).toContainText('Public requirements (no personal data)');
    await expect(pageA.getByRole('region', { name: 'Data context' })).not.toContainText('Record revision');
    await expect(pageA.getByText('ZZ 299')).toHaveCount(0);
    await pageA.getByRole('link', { name: 'My record', exact: true }).click();
    await expect(pageA.getByRole('heading', { level: 1, name: 'Sign in required' })).toBeVisible();
  });
});
