import { expect, test } from '@playwright/test';
import { signup, uniqueUser } from './helpers';

/**
 * CP-45: a reviewer who creates an account and has no data of their own is offered the synthetic example on the first page, loads it with one click,
 * sees the requirements counted on it, and generates a plan that covers the rest of the degree. The offer is gone once the record has data.
 */
test('a reviewer with no data finds the synthetic example at once, loads it and plans the rest of the degree (CP-45)', async ({ page }) => {
  await signup(page, uniqueUser('e2e_example'));

  // On the very first page, before anything else is done.
  const offer = page.getByRole('region', { name: 'Synthetic example' });
  await expect(offer).toBeVisible();
  await expect(offer.getByRole('heading', { name: /No data yet\? Try the synthetic example/ })).toBeVisible();

  // The other pages carry it too.
  await page.goto('/plan');
  await expect(offer).toBeVisible();

  // One click loads the made-up student and lands on the requirements.
  await offer.getByRole('button', { name: 'Load the synthetic example' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Graduation requirements' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('92 of 170').first()).toBeVisible();
  await expect(offer).toHaveCount(0);

  // The record is the made-up student's, with real course codes and plainly made-up titles.
  await page.goto('/record');
  await expect(page.getByText('Sample course (ES 101)').first()).toBeVisible();

  // The planner can finish the degree from it.
  await page.goto('/plan');
  await page.getByRole('button', { name: 'Generate plan' }).click();
  const draft = page.getByRole('region', { name: 'Draft plan (not saved)' });
  await expect(draft).toBeVisible({ timeout: 60_000 });
  await expect(draft.getByText(/Every requirement is covered/)).toBeVisible();
  await expect(draft.getByText(/132 of 170 degree credits covered by your plan/)).toBeVisible();
  await expect(offer).toHaveCount(0);
});
