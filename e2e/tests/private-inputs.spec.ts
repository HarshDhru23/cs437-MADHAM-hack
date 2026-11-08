import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { signup, uniqueUser } from './helpers';

/**
 * Opt-in local check of the supplied private inputs through the real browser
 * flow (A03 browser cases: PDF -> 39 rows -> commit; IMS -> 40 rows -> extra
 * short-course row). The page no longer prints row counts or totals, so the rows
 * are counted in each term's table. Skipped unless COURSEPATH_REAL_INPUT_DIR names
 * the local directory holding the two supplied files, the same convention as
 * tests/imports/test_private_inputs.py. Expected values are the independent
 * controls in docs/implementation-roadmap.md section 4.4, never parser output.
 * Nothing from these files is committed; traces and screenshots are disabled.
 * Run it on its own (`npx playwright test private-inputs`): Django allows 10
 * account actions per IP per 15 minutes and the rest of the suite uses 9.
 */
const directory = process.env.COURSEPATH_REAL_INPUT_DIR;
const pdfPath = directory ? path.join(directory, '24110107-B.Tech-ASSISTANTREGISTRAR(ACADEMICS)AT.pdf') : '';
const imsPath = directory ? path.join(directory, 'copied_input.txt') : '';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(!directory || !existsSync(pdfPath) || !existsSync(imsPath), 'Private samples not supplied to this test run');

const TERMS = ['2024–25 Semester I', '2024–25 Semester II', '2025–26 Semester I', '2025–26 Semester II'];

test('supplied transcript and IMS paste reproduce the roadmap controls in the browser', async ({ page }) => {
  await signup(page, uniqueUser('e2e_private'));

  // Transcript PDF: 39 rows, 10/10/10/9 by term (counted in the tables; the page prints no counts).
  await page.getByRole('tab', { name: 'Upload transcript PDF' }).click();
  await page.getByLabel('Choose transcript PDF').setInputFiles(pdfPath);
  await page.getByRole('button', { name: 'Parse transcript' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
  await expect(page.getByText(/rows found/)).toHaveCount(0);
  const pdfTerms: [string, number][] = [
    [TERMS[0]!, 10],
    [TERMS[1]!, 10],
    [TERMS[2]!, 10],
    [TERMS[3]!, 9],
  ];
  for (const [term, rows] of pdfTerms) {
    await expect(page.getByRole('table', { name: term, exact: true }).locator('tbody tr')).toHaveCount(rows);
  }
  await expect(page.getByRole('region', { name: 'Lines that could not be read' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm record' }).click();
  await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();

  // Performance from the accepted record: 849 points over 92 performance credits; P excluded, never 105.
  await page.goto('/performance');
  const cpi = page.getByRole('region', { name: 'Cumulative CPI' });
  await expect(cpi).toContainText('849');
  await expect(cpi).toContainText('92');
  await expect(cpi).not.toContainText('105');
  await expect(cpi.getByText('CPI', { exact: true }).locator('..')).toContainText('9.23');

  // IMS paste over the same record: 40 rows, 28/23/28/26, 105 raw; the extra short course is new and reviewable.
  await page.goto('/record/import');
  await page.getByRole('tab', { name: 'Paste IMS grades' }).click();
  await page.getByLabel('IMS grade table').fill(readFileSync(imsPath, 'utf8').replace(/^﻿/, ''));
  await page.getByRole('button', { name: 'Parse grades' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Review imported rows' })).toBeVisible();
  const imsTerms: [string, number][] = [
    [TERMS[0]!, 10],
    [TERMS[1]!, 11],
    [TERMS[2]!, 10],
    [TERMS[3]!, 9],
  ];
  for (const [term, rows] of imsTerms) {
    await expect(page.getByRole('table', { name: term, exact: true }).locator('tbody tr')).toHaveCount(rows);
  }
  await expect(page.getByText(/^Compared with your saved record: 1 new,/)).toBeVisible();
  const shortCourse = page.getByRole('table', { name: TERMS[1]!, exact: true }).getByRole('row', { name: /SC 372/ });
  await expect(shortCourse).toContainText('New');
  await expect(shortCourse).not.toContainText(/Needs review|\bD-\d\d\b/); // SC 372 is decided: nothing to review, and no decision id on screen
});
