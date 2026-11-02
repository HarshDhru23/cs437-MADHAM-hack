import { expect, test } from '@playwright/test';

// Flow 1 (CP-01): full requirements before login/history, through the real API.
// Expected labels, version and sources are from the reviewed rules in data/curricula/cse-2024.json (ADV13, D-16).
// The draft banner and unreviewed-policy states are covered by the frontend unit tests.
test('public requirements are browsable before sign-in, with review status and sources', async ({ page }) => {
  const personalCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/(record|analysis|plans)/.test(r.url())) personalCalls.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'CSE 2024 graduation requirements' })).toBeVisible();
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
    await expect(list.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Data context' })).toContainText('cse-2024-v1 (reviewed)');
  await expect(page.getByText(/These rules are a draft/)).toHaveCount(0);
  const obligations = page.getByRole('region', { name: 'Non-credit obligations' });
  await expect(obligations).toContainText('Comprehensive viva');
  await expect(obligations).not.toContainText('not yet reviewed');

  await page.getByRole('button', { name: 'Why? CSE core' }).click();
  const dialog = page.getByRole('dialog', { name: /CSE core/ });
  await expect(dialog).toContainText('Academic Affairs Advisory No. 13');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
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
