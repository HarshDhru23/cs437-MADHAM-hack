import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

// Responsive/keyboard checks on public screens (no account actions, so the
// login throttle is unaffected). 720px at 1440 equals 200% browser zoom.
for (const viewport of [
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'tablet 768', width: 768, height: 1024 },
  { name: '200% zoom of 1440', width: 720, height: 450 },
  { name: 'desktop 1440', width: 1440, height: 900 },
]) {
  test(`requirements and import screens fit at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Graduation requirements' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.goto('/record/import');
    await expect(page.getByRole('tab', { name: 'Upload transcript PDF' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // Touch targets: primary controls are at least ~44px tall.
    const box = await page.getByRole('tab', { name: 'Paste IMS grades' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43);
  });
}

test('keyboard focus starts with the skip link and follows reading order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Graduation requirements' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  const order: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? ''));
  }
  expect(order.slice(0, 4)).toEqual(['CoursePath', 'Requirements', 'My record', 'Plan']);
  // Focus is visible (outline is not removed).
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('the import tabs can be operated with the keyboard alone', async ({ page }) => {
  await page.goto('/record/import');
  await page.getByRole('tab', { name: 'Upload transcript PDF' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Paste IMS grades' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('IMS grade table')).toBeVisible();
});
