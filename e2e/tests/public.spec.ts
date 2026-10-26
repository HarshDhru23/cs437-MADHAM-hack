import { expect, test } from '@playwright/test';

// Flow 1 (CP-01): full requirements before login/history, through the real API.
test('public requirements are browsable before sign-in, with draft status and sources', async ({ page }) => {
  const personalCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/(record|analysis|plans)/.test(r.url())) personalCalls.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'CSE 2024 graduation requirements' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Requirements' });
  for (const name of ['Institute core', 'HSS (GE included)', 'Cse core', 'Cse electives', 'Science basket', 'Bs elective', 'Open electives']) {
    await expect(list.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/These rules are a draft/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Non-credit obligations' })).toContainText('Completion policy not yet reviewed');
  await expect(page.getByRole('region', { name: 'Data context' })).toContainText('cse-2024-draft-v1');

  await page.getByRole('button', { name: 'Why? Cse core' }).click();
  const dialog = page.getByRole('dialog', { name: /Cse core/ });
  await expect(dialog).toContainText('Committed implementation roadmap');
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
