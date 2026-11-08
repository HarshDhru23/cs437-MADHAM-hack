import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, IMS_TEXT, semester, signup, uniqueUser, createBlankPlan } from './helpers';

/**
 * Flow 6 (aaryan.md A10) on the real stack: baseline clone -> hypothetical drop
 * and grade -> compare -> none / 3 / 6 month internship dates and a proposed
 * module -> zero automatic credit -> explicit plan-only apply with the accepted
 * record unchanged. Uses one account action (signup) of the login throttle.
 */
test.describe.serial('scenarios and internship comparison', () => {
  let page: Page;
  let recordBefore: { revision: number; attempts: unknown[] };
  let dropScenarioUrl = '';

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  });

  const record = async () => ((await (await page.request.get('/api/v1/record')).json()) as { data: { revision: number; attempts: unknown[] } }).data;

  async function addCourse(term: string, code: string) {
    await semester(page, term).getByRole('button', { name: `Add course to ${term}` }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`Add course to ${term}`) });
    await dialog.getByLabel('Course code').fill(code);
    await dialog.getByLabel(/Credits/).fill('4');
    await dialog.getByRole('button', { name: 'Add course', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Plan save status' })).toContainText('Saved');
  }

  async function createScenario(name: string) {
    await page.goto('/scenarios');
    await page.getByLabel('Scenario name').fill(name);
    await page.getByRole('button', { name: 'Create scenario' }).click();
    await expect(page).toHaveURL(/\/scenarios\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  }

  async function save(revision: number) {
    await page.getByRole('button', { name: 'Save scenario' }).click();
    await expect(page.getByRole('status', { name: 'Scenario save status' })).toHaveText('Saved');   // saved number ${revision} is not shown
    await expect(page.getByText('Results are up to date.')).toBeVisible();
  }

  test('sign up, import synthetic IMS grades and plan a few courses', async () => {
    await signup(page, uniqueUser('e2e_scen'));
    await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
    await page.getByLabel('IMS grade table').fill(IMS_TEXT);
    await page.getByRole('button', { name: 'Parse grades' }).click();
    await expect(page).toHaveURL(/\/record\/review\//);
    const unparsed = page.getByRole('region', { name: 'Lines that could not be read' });
    await unparsed.getByLabel(/Omit these lines/).check();
    await unparsed.getByLabel(/Reason/).fill('Footer text, not a course');
    await page.getByRole('button', { name: 'Confirm record' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
    recordBefore = await record();
    expect(recordBefore.attempts).toHaveLength(7);

    await page.goto('/plan');
    await createBlankPlan(page);
    await addCourse('2026–27 Semester I', 'CS 202');
    await addCourse('2026–27 Semester I', 'CS 330');
    await addCourse('2026–27 Semester II', 'CS 331');
    await expect(page.getByRole('link', { name: 'What-if scenarios' })).toBeVisible();
  });

  test('a scenario with a drop and a hypothetical grade is compared against the baseline (CP-28)', async () => {
    await createScenario('Drop and grade');
    dropScenarioUrl = page.url();
    const banner = page.getByRole('region', { name: 'Scenario (hypothetical)' });
    await expect(banner).toContainText('Based on plan');
    await expect(banner).not.toContainText(/revision/i);
    await expect(banner.getByRole('link', { name: 'Return to baseline' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Data context' })).toContainText('A what-if scenario');

    const form = page.getByRole('form', { name: 'Add a hypothetical change' });
    await form.getByLabel('Change type').selectOption('drop');
    // The planned course is found by typing: a code without a space here, part of the title below.
    await form.getByRole('combobox', { name: 'Planned course' }).fill('cs202');
    await form.getByRole('option', { name: /^CS 202 · .*2026–27 Semester I/ }).click();
    await form.getByRole('button', { name: 'Add change' }).click();
    await form.getByLabel('Change type').selectOption('grade');
    await form.getByRole('combobox', { name: 'Planned course' }).fill('oper');
    await expect(form.getByRole('option', { name: /^CS 330 · Operating Systems · 2026–27 Semester I/ })).toBeVisible();
    await form.getByRole('combobox', { name: 'Planned course' }).press('Enter');   // Enter chooses the best match and does not add the change
    await expect(form.getByRole('group', { name: 'Planned course' })).toContainText('CS 330 · Operating Systems');
    await form.getByLabel('Hypothetical letter grade').selectOption('B');
    await form.getByRole('button', { name: 'Add change' }).click();
    const changes = page.getByRole('list', { name: 'Hypothetical changes' });
    await expect(changes).toContainText('Drop CS 202 (2026–27 Semester I)');
    await expect(changes).toContainText('Hypothetical grade B for CS 330 (2026–27 Semester I)');
    await expect(page.getByText(/You have unsaved changes\. The results below are for the saved version/)).toBeVisible();
    await save(1);

    // The what-if diff above the table: the dropped course is a "-" line, a hypothetical grade a "+" line; both come from the scenario itself.
    const diff = page.getByRole('group', { name: 'Changes in Drop and grade compared with your plan' });
    await expect(diff).toContainText('- 2026–27 Semester I   CS 202   4');
    await expect(diff).toContainText('+ 2026–27 Semester I   CS 330   hypothetical grade B');
    const table = page.getByRole('table', { name: 'Baseline vs scenario' });
    await expect(table.getByRole('row', { name: /^Affected courses/ })).toContainText('Drop CS 202 (2026–27 Semester I)');
    // Expected from the reviewed rules, not from the app: CS 202 is the mandatory "Software Tools and Techniques
    // for CSE" core course (ADV13 p. 14) and CS 203 never satisfies it (D-03), so dropping the planned CS 202
    // changes that requirement in the projection.
    await expect(table.getByRole('row', { name: /^Requirements that change/ })).toContainText('Software Tools and Techniques for CSE');
    // no scenario in the table has an internship, so the internship rows are not shown at all
    await expect(table.getByRole('row', { name: /^Internship credits earned/ })).toHaveCount(0);
  });

  test('none / 3 / 6 month internships with exact dates and a proposed module award no automatic credit (CP-33/34)', async () => {
    await page.goto(dropScenarioUrl);
    await page.getByRole('radio', { name: 'No internship' }).check();
    await save(2);

    await createScenario('Three months');
    await page.getByRole('radio', { name: '3 months' }).check();
    await page.getByRole('radio', { name: 'Summer' }).check();
    await page.getByLabel('Start date').fill('2027-05-01');
    await page.getByLabel('Last day (inclusive)').fill('2027-07-31');
    await page.getByLabel('Placement').selectOption('onsite_full_time');
    await save(1);
    const time = page.getByRole('region', { name: 'Time away / course conflicts' });
    // 1 May to 31 July inclusive is 92 days, exactly three calendar months.
    await expect(time).toContainText('Actual duration92 days');
    await expect(time).not.toContainText('These dates do not match');
    // data/calendars/2026-27.json (D-24): the summer term runs 7 May to 3 July 2027 (end-exclusive), 57 days,
    // all inside these dates, and both summer exam windows fall in it.
    await expect(time).toContainText('2026–27 Summer: 57 days away, including exams');
    const credit = page.getByRole('region', { name: 'Proposed academic credit' });
    await expect(credit).toContainText('Choosing a duration awards no credit.');
    await expect(credit.getByRole('group', { name: 'Exposure credits' })).toContainText('Proposed (pending approval)0');
    await expect(credit.getByRole('group', { name: 'Exposure credits' })).toContainText('Earned0');

    await createScenario('Six months');
    await page.getByRole('radio', { name: '6 months' }).check();
    await page.getByLabel('Start date').fill('2027-07-01');
    await page.getByLabel('Last day (inclusive)').fill('2027-12-30');
    await page.getByRole('button', { name: 'Add IN 498 module' }).click();
    await page.getByLabel('Target basket for IN 498 module 1').selectOption('open_elective');
    await save(1);
    // The last day is one short of six calendar months: the server measures it and the UI explains it.
    const away = page.getByRole('region', { name: 'Time away / course conflicts' });
    await expect(away).toContainText('Actual duration183 days');
    await expect(away).toContainText('would end on 31 Dec 2027 (last day)');
    const proposed = page.getByRole('region', { name: 'Proposed academic credit' });
    await expect(proposed.getByRole('group', { name: 'Exposure credits' })).toContainText('Proposed (pending approval)4');
    await expect(proposed.getByRole('group', { name: 'Exposure credits' })).toContainText('Approved (not yet earned)0');
    await expect(proposed.getByRole('group', { name: 'Exposure credits' })).toContainText('Earned0');
    await expect(proposed.getByRole('list', { name: 'Module approval states' })).toContainText('Proposed, pending approval');
    await expect(proposed).not.toContainText('INTERNSHIP_APPROVAL_REQUIRED');   // issue codes are not shown

    const also = page.getByRole('group', { name: 'Also compare (same baseline plan)' });
    await also.getByLabel(/Drop and grade/).check();
    await also.getByLabel(/Three months/).check();
    const cases = page.getByRole('table', { name: 'Internship cases on the same baseline' });
    await expect(cases.getByRole('columnheader')).toHaveText(['Measure', '6 months — Six months', 'No internship — Drop and grade', '3 months — Three months']);
    await expect(cases.getByRole('row', { name: /^Earned credits/ })).toHaveText(/^Earned credits\s*0\s*0\s*0$/);
    await expect(cases.getByRole('row', { name: /^Approved credits/ })).toHaveText(/^Approved credits\s*0\s*0\s*0$/);
    await expect(cases.getByRole('row', { name: /^Proposed credits/ })).toHaveText(/^Proposed credits \(pending approval\)\s*4\s*0\s*0$/);
    await expect(cases.getByRole('row', { name: /^Completion assumptions/ })).toContainText('No IN 498 modules: the internship earns no academic credit by itself.');
    const compare = page.getByRole('table', { name: 'Baseline vs scenario' });
    await expect(compare.getByRole('columnheader')).toHaveCount(5);
    await expect(compare.getByRole('row', { name: /^Affected courses/ })).toContainText('Drop CS 202');
  });

  test('the scenario screen fits a 390 px phone without horizontal scrolling (CP-31)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('region', { name: 'Proposed academic credit' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('apply writes only plan edits, leaves the accepted record unchanged and rebases afterwards (CP-28)', async () => {
    await page.goto(dropScenarioUrl);
    await page.getByRole('button', { name: 'Apply to plan…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Apply plan edits' });
    await expect(dialog.getByRole('list', { name: 'Plan edits to write' })).toHaveText('Drop CS 202 (2026–27 Semester I)');
    await expect(dialog.getByRole('list', { name: 'Not applied' })).toContainText('Hypothetical grade B for CS 330 (2026–27 Semester I)');
    await expect(dialog.getByRole('list', { name: 'Not applied' })).toContainText('Internship choice: No internship');
    await expect(dialog).toContainText('Your record is never changed.');
    await dialog.getByRole('button', { name: 'Apply to plan' }).click();
    const done = page.getByRole('status').filter({ hasText: 'Plan updated.' });
    await expect(done).toContainText('Your record was not changed.');
    await expect(done).toContainText('grade');
    // The baseline moved, so the scenario now asks for an explicit rebase.
    await expect(page.getByRole('button', { name: 'Rebase on current record and plan' })).toBeVisible();
    // Rebasing leaves out the drop that is now in the plan (the server would refuse it) and keeps the hypothetical grade.
    await page.getByRole('button', { name: 'Rebase on current record and plan' }).click();
    await expect(page.getByText('The baseline changed.')).toBeHidden();
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
    const changes = page.getByRole('list', { name: 'Hypothetical changes' });
    await expect(changes).toContainText('Hypothetical grade B for CS 330');
    await expect(changes).not.toContainText('Drop CS 202');
    await expect(page.getByRole('table', { name: 'Baseline vs scenario' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply to plan…' })).toBeDisabled();

    const after = await record();
    expect(after.revision).toBe(recordBefore.revision);
    expect(after.attempts).toEqual(recordBefore.attempts);

    await page.getByRole('link', { name: 'Return to baseline' }).click();
    await expect(semester(page, '2026–27 Semester I')).toContainText('CS 330');
    await expect(semester(page, '2026–27 Semester I')).not.toContainText('CS 202');
    await page.goto('/record');
    const history = page.getByRole('region', { name: 'Academic history' });
    await expect(history).toContainText('ES 242(N)');
    await expect(history).not.toContainText('CS 330');
  });

  test('saving, leaving and coming back still saves, and a scenario can be deleted from its page and from the list', async () => {
    await createScenario('Scratch one');
    await page.getByLabel('Scenario name').fill('Scratch one renamed');
    await save(1);
    await page.getByRole('link', { name: 'Scenarios', exact: true }).click();
    await page.getByRole('link', { name: 'Scratch one renamed' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Scratch one renamed' })).toBeVisible();
    await page.getByLabel('Scenario name').fill('Scratch one again');
    await save(2);
    await expect(page.getByText(/saved elsewhere/i)).toHaveCount(0);   // the second save used the revision the first one produced

    // delete the current scenario from its own page: always asked first, nothing else is touched
    await page.getByRole('button', { name: 'Delete scenario', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete scenario' });
    await expect(dialog).toContainText('Your baseline plan and accepted record are not changed.');
    await dialog.getByRole('button', { name: 'Delete scenario', exact: true }).click();
    await expect(page).toHaveURL(/\/scenarios$/);
    await expect(page.getByRole('status').filter({ hasText: 'deleted' })).toContainText('Scratch one again');
    await expect(page.getByRole('link', { name: 'Scratch one again' })).toHaveCount(0);

    // and from the list
    await createScenario('Scratch two');
    await page.goto('/scenarios');
    await page.getByRole('button', { name: 'Delete scenario Scratch two' }).click();
    await page.getByRole('dialog', { name: 'Delete this scenario?' }).getByRole('button', { name: 'Delete scenario', exact: true }).click();
    await expect(page.getByText('Deleted “Scratch two”.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Scratch two' })).toHaveCount(0);
    await expect(page.getByText(/Something went wrong|D-\d\d|[A-Z]{3,}_[A-Z_]{3,}/)).toHaveCount(0);
  });
});
