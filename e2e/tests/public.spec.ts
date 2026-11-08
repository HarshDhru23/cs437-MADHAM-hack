import { expect, test } from '@playwright/test';

// Flow 1 (CP-01): full requirements before login/history, through the real API.
// Expected labels and courses are from the reviewed rules in data/curricula/cse-2024.json (ADV13).
// The page shows no rule version, review status, source or decision text.
test('public requirements are browsable before sign-in, each group opening to its courses', async ({ page }) => {
  const personalCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/(record|analysis|plans)/.test(r.url())) personalCalls.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Graduation requirements' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Requirements' });
  for (const name of [
    'Institute core',
    'Humanities and Social Sciences (GE included)',
    'CSE core',
    'CSE discipline electives',
    'Science basket',
    'Basic Science elective',
    'Open electives',
  ]) {
    await expect(list.getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}\\s*\\d`) })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Data context' })).toContainText('B.Tech CSE, 2024 entry');
  await expect(page.getByText(/cse-2024-v1|Rule set|review status|draft/i)).toHaveCount(0);
  const obligations = page.getByRole('region', { name: 'Other requirements' });
  await expect(obligations).toContainText('Comprehensive viva');
  await expect(obligations).toContainText('Physical education');

  // Opening a group lists its courses; opening it again hides them.
  const core = list.getByRole('button', { name: /^Institute core\s*\d/ });
  await expect(core).toHaveAttribute('aria-expanded', 'false');
  await core.click();
  await expect(core).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByText('ES 101')).toBeVisible();
  await expect(list.getByText('Engineering Graphics')).toBeVisible();
  const hss = list.getByRole('button', { name: /^Humanities and Social Sciences \(GE included\)\s*\d/ });
  await hss.click();
  await expect(list.getByText('HS 191')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Why\?/ })).toHaveCount(0);
  await expect(page.getByText(/\bD-\d\d\b|Advisory No\. 13|ADV13/)).toHaveCount(0);
  await core.click();
  await expect(core).toHaveAttribute('aria-expanded', 'false');
  expect(personalCalls).toEqual([]);
});

test('deep links survive a reload of the production build', async ({ page }) => {
  await page.goto('/record/import');
  await expect(page.getByRole('heading', { level: 1, name: 'Add your academic record' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Add your academic record' })).toBeVisible();
  await page.goto('/plan/does-not-matter');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in required' })).toBeVisible();
});
