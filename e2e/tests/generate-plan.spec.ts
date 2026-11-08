import { expect, test } from '@playwright/test';
import { IMS_TEXT, signup, uniqueUser } from './helpers';

/**
 * CP-35 on the real stack: synthetic account -> IMS record -> Plan tab -> Generate plan (one click, no dialog) -> review the
 * draft (nothing saved) -> switch the internship semester and the load several times (never hangs) -> add a course twice and see
 * the problem in that semester at once -> add elective credits and see what each requirement still needs -> remove a course ->
 * add an online course by hand -> reset to the generated plan -> discard -> generate again -> name the plan and save it -> it opens
 * in the planner under that name and persists.
 * The student sees no decision numbers, issue codes, rule talk or timetable-snapshot wording anywhere in the draft.
 */
test('generate a draft plan, edit it, discard it, then save one as my plan (CP-35)', async ({ page }) => {
  test.setTimeout(180_000);
  await signup(page, uniqueUser('e2e_generate'));
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
  const generateButton = page.getByRole('button', { name: 'Generate plan' });
  await expect(generateButton).toBeVisible();
  await expect(page.getByRole('button', { name: /Create (a|another) plan/ })).toHaveCount(0); // no empty "My plan" to create: plans start from Generate plan

  // First draft: one click, no dialog. Reviewed, edited, then discarded. Nothing is saved.
  await generateButton.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const draft = page.getByRole('region', { name: 'Draft plan (not saved)' });
  await expect(draft).toBeVisible({ timeout: 60_000 });
  await expect(draft.getByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ }).first()).toBeVisible();
  const saveButton = draft.getByRole('button', { name: 'Save as my plan' });
  await expect(saveButton).toBeEnabled({ timeout: 30_000 }); // the server has checked the generated plan
  await expect(draft.getByText(/of 170 degree credits covered by your plan/)).toBeVisible();
  await expect(draft.getByText(/\/ 28 credits/).first()).toBeVisible();
  // The board: a load strip with one labelled cell per semester, and a meter in every column.
  const strip = draft.getByRole('group', { name: 'Load by semester' });
  await expect(strip).toBeVisible();
  expect(await strip.getByRole('listitem').count()).toBe(await draft.getByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ }).count());
  await expect(strip.getByRole('listitem').first()).toContainText(/\d+ \/ 28/);
  await expect(draft.getByText(/credits left for graduation|Every requirement is covered/).first()).toBeVisible(); // what is left, from the server check
  await expect(draft.getByText(/more credits? can be added|no more credits can be added/).first()).toBeVisible(); // room left in a semester
  const developerText = /D-\d\d|[A-Z]{3,}_[A-Z_]{3,}|standing|snapshot|assumption|Expected \(unconfirmed\)|Confirmed in|advisor|guidance|CoursePath team|Recommended preparation/i;
  expect((await draft.innerText()).match(developerText)).toBeNull();

  // The internship semester and the load: switching them one after another never leaves the page waiting.
  const internship = draft.getByLabel('Internship semester');
  await expect(internship.locator('option').first()).toHaveText('No internship');
  const options = await internship.locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(2);
  await internship.selectOption({ index: 2 });
  await internship.selectOption({ index: 3 });
  await draft.getByLabel('Credits per semester').selectOption('lighter');
  await internship.selectOption({ index: 1 });
  await expect(page.getByText('Building your plan…')).toHaveCount(0, { timeout: 60_000 });
  await expect(internship).toHaveValue(/20\d\d-\d\d-(I|II)/);
  await expect(draft.getByLabel('Credits per semester')).toHaveValue('lighter');
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  await internship.selectOption({ index: 0 }); // back to no internship, as many credits as possible
  await draft.getByLabel('Credits per semester').selectOption('most');
  await expect(page.getByText('Building your plan…')).toHaveCount(0, { timeout: 60_000 });
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  expect((await draft.innerText()).match(developerText)).toBeNull();

  // Adding a course the plan already has: the problem is in that semester at once, in plain words, and Save still works for a warning.
  const firstCard = draft.getByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ }).first();
  const plannedCode = (await firstCard.locator('tbody th .mono').first().innerText()).trim();
  const addLabel = (await firstCard.getByRole('button', { name: /^Add course to / }).getAttribute('aria-label')) ?? '';
  await firstCard.getByRole('button', { name: /^Add course to / }).click();
  const picker = page.getByRole('dialog', { name: /^Add course to / });

  // Find a course by requirement: choosing "Systems basket" lists the Systems basket courses of THIS semester's timetable and no others.
  // Expected from data/curricula/cse-2024.json (Systems basket) and the committed timetables, never from the app:
  // the odd-semester timetable offers CS 435 and ES 668 of that basket, the even-semester one CS 327, CS 431, CS 432 and CS 616.
  const systemsOffered = /Semester II$/.test(addLabel) ? ['CS 327', 'CS 431', 'CS 432', 'CS 616'] : ['CS 435', 'ES 668'];
  await picker.getByLabel('Requirement', { exact: true }).selectOption({ label: 'Systems basket' });
  const found = picker.getByRole('list', { name: 'Matching courses' });
  await expect(found.getByRole('listitem')).toHaveCount(systemsOffered.length);
  expect(await found.locator('li strong.mono').allInnerTexts()).toEqual(systemsOffered);
  expect((await picker.innerText()).match(/open-electives|bs-elective|cse-core|[A-Z]{3,}_[A-Z_]{3,}|Expected \(unconfirmed\)/)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await firstCard.getByRole('button', { name: /^Add course to / }).click();
  await picker.getByLabel('Course code').fill(plannedCode);
  await picker.getByLabel(/Credits/).fill('4');
  await picker.getByRole('button', { name: 'Add course', exact: true }).click();
  await expect(firstCard.getByRole('list', { name: /^Problems in / })).toContainText(`${plannedCode} is already in your plan`, { timeout: 30_000 });
  await firstCard.getByRole('button', { name: new RegExp(`^Remove ${plannedCode} from `) }).last().click();
  await expect(firstCard.getByRole('list', { name: /^Problems in / }).filter({ hasText: 'is already in your plan' })).toHaveCount(0, { timeout: 30_000 });

  // Elective credits: pick a requirement that still needs credits, and the progress follows.
  // The last semester has room (earlier ones are packed to 28), so the default credits fit and the plan stays saveable.
  const lastCard = draft.getByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ }).last();
  const elective = lastCard.getByRole('button', { name: /^Add elective credits to / });
  if (await elective.isEnabled()) {
    await elective.click();
    const form = lastCard.getByRole('form', { name: /^Add elective credits to / });
    await expect(form.getByLabel('Requirement').locator('option').first()).toContainText(/needed/);
    if ((await form.getByLabel('Credits').inputValue()) !== '') {
      await form.getByRole('button', { name: 'Add credits' }).click();
      await expect(draft.getByRole('region', { name: 'Your plan so far' }).getByText('Updating…')).toHaveCount(0, { timeout: 30_000 });
      await expect(saveButton).toBeEnabled({ timeout: 30_000 });
    }
  }

  // An online course by hand: it is named, counts toward a requirement, and the plan says how many online credits are planned.
  if ((await lastCard.getByText(/no more credits can be added/).count()) === 0) {
    await lastCard.getByRole('button', { name: /^Add online course to / }).click();
    const onlineForm = lastCard.getByRole('form', { name: /^Add online course to / });
    await onlineForm.getByLabel('Course name (optional)').fill('Machine Learning on NPTEL');
    await onlineForm.getByRole('button', { name: 'Add online course' }).click();
    await expect(lastCard.getByText('Machine Learning on NPTEL')).toBeVisible();
    await expect(draft.getByRole('region', { name: 'Your plan so far' }).getByText(/Online credits: \d+ planned, \d+ count toward your degree/)).toBeVisible({ timeout: 30_000 });
    await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  }

  // Remove a course: the server re-checks the plan and the totals follow.
  const firstRemove = draft.getByRole('button', { name: /^Remove (?!Internship|Online|Open project)[A-Z]{2,4} \d/ }).first();
  const removeLabel = (await firstRemove.getAttribute('aria-label')) ?? '';
  await firstRemove.click();
  await expect(draft.getByRole('button', { name: removeLabel })).toHaveCount(0);
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });

  // Reset to the generated plan: the course comes back, the hand-made online course goes, and the button is off again.
  const reset = draft.getByRole('button', { name: 'Reset to generated plan' });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(draft.getByRole('button', { name: removeLabel })).toHaveCount(1);
  await expect(draft.getByText('Machine Learning on NPTEL')).toHaveCount(0);
  await expect(reset).toBeDisabled();
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  await draft.getByRole('button', { name: 'Discard' }).click();
  await expect(draft).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/You have no saved plans yet/)).toBeVisible();

  // The command bar opens /plan?generate=1: one draft appears without a click, and the address is clean afterwards (a reload does not repeat it).
  await page.goto('/plan?generate=1');
  const fromBar = page.getByRole('region', { name: 'Draft plan (not saved)' });
  await expect(fromBar.getByRole('button', { name: 'Save as my plan' })).toBeEnabled({ timeout: 60_000 });
  await expect(page).not.toHaveURL(/generate=1/);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Draft plan (not saved)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate plan' })).toBeVisible();

  // Second draft: saved as my plan, which opens in the planner and survives a reload.
  await page.getByRole('button', { name: 'Generate plan' }).click();
  const second = page.getByRole('region', { name: 'Draft plan (not saved)' });
  await expect(second.getByRole('button', { name: 'Save as my plan' })).toBeEnabled({ timeout: 60_000 });
  await expect(second.getByLabel('Plan name')).toHaveValue('Generated plan'); // the default; the student can rename it
  await second.getByLabel('Plan name').fill('My e2e plan');
  await second.getByRole('button', { name: 'Save as my plan' }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My e2e plan' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'My e2e plan' })).toBeVisible();
});
