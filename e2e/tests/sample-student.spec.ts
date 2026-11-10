import { expect, test } from '@playwright/test';
import { resetAccountThrottle } from './helpers';

/**
 * CR-137 (CP-37): "Try with a sample student" on the real stack. A visitor with no account and no transcript sees the audit and the planner working
 * on a made-up record, is told plainly it is made up, cannot import or delete data, and leaves it: the sample account is then gone.
 */
test('a visitor tries the sample student, sees the requirements and the planner, and leaves (CP-37)', async ({ page }) => {
  resetAccountThrottle();
  await page.goto('/login');
  await page.getByRole('button', { name: 'Try with a sample student' }).click();
  await expect(page).toHaveURL(/\/record$/);
  const banner = page.getByRole('status', { name: 'Sample student' });
  await expect(banner).toContainText('You are looking at a sample student. Every course and grade here is made up and nothing is saved to a real account.');
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(page.getByText('Sample course (ES 101)').first()).toBeVisible();

  // The audit.
  await page.getByRole('link', { name: 'Requirements', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Graduation requirements' })).toBeVisible();
  await expect(banner).toBeVisible();

  // The planner: one click on Generate plan gives a draft for the remaining credits.
  await page.goto('/plan');
  await page.getByRole('button', { name: 'Generate plan' }).click();
  const draft = page.getByRole('region', { name: 'Draft plan (not saved)' });
  await expect(draft).toBeVisible({ timeout: 60_000 });
  await expect(draft.getByText(/of 170 degree credits covered by your plan/)).toBeVisible();

  // A made-up record takes no real data in and has nothing of its own to delete.
  await page.goto('/record/import');
  await expect(page.getByText('The sample student cannot import a record. Sign in with your IITGN Google account to use your own.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Upload transcript PDF' })).toHaveCount(0);
  await page.goto('/account');
  await expect(page.getByText('This is a sample student. Nothing here is real. Use Leave the sample to remove it.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Delete my data' })).toHaveCount(0);

  // Leaving removes the sample: the session is gone and stays gone after a reload.
  await page.getByRole('button', { name: 'Leave the sample' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('status', { name: 'Sample student' })).toHaveCount(0);
  const session = await page.request.get('/api/v1/session');
  expect(((await session.json()) as { data: { user: unknown } }).data.user).toBeNull();
  await page.goto('/record');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in required' })).toBeVisible();
});

test('two visitors get two separate sample accounts, and one leaving does not end the other (CP-37)', async ({ browser }) => {
  resetAccountThrottle();
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const one = await first.newPage();
    const two = await second.newPage();
    for (const page of [one, two]) {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Try with a sample student' }).click();
      await expect(page).toHaveURL(/\/record$/);
    }
    const accountOf = async (page: typeof one) => ((await (await page.request.get('/api/v1/session')).json()) as { data: { user: { id: string; username: string; demo?: boolean } } }).data.user;
    const [a, b] = [await accountOf(one), await accountOf(two)];
    expect(a.demo).toBe(true);
    expect(b.demo).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(a.username).not.toBe(b.username);

    await one.getByRole('button', { name: 'Leave the sample' }).click();
    await expect(one).toHaveURL(/\/login$/);
    await two.reload();
    await expect(two.getByRole('status', { name: 'Sample student' })).toBeVisible();
    expect((await accountOf(two)).id).toBe(b.id);
  } finally {
    await first.close();
    await second.close();
  }
});
