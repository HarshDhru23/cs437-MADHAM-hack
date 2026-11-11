/**
 * CP-43 in the generated draft: every course in the draft carries its course plan link, or "Course plan not available yet", like a course in
 * a saved plan. The draft is `examples/plan-generation.json` (ZZ 201 and ZZ 310 in 2026-27 Semester I, ZZ 201B in 2027-28 Semester I). The
 * links are made up for the test (https://example.org/...); the shape is the importer's `{target, display_text, locator}`.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import generationExample from '../../../../examples/plan-generation.json';
import type { PlanCheck, PlanValidation } from '../../api/types';
import { curriculum, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { PlanIndexPage } from './PlanPage';

const ZZ201 = 'https://example.org/course-plans/zz201.docx';
const emptyValidation = { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } as PlanValidation;
const check: PlanCheck = {
  validation: emptyValidation,
  degree: { total_credits: '170', counted_credits: '100', remaining_credits: '70' },
  placeholder_credits: '0',
  uncovered_credits: '70',
  requirements: [],
  online: { planned_credits: '0', counted_credits: '0' },
  load: {
    '2026-27-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' },
    '2027-28-I': { planned_credits: '4', limit_credits: '28', available_credits: '24' },
  },
  status: { valid: false, problems: 0, uncovered_credits: '70' },
};

const snapshot = (term: string, links: Record<string, { target: string | null; display_text: string; locator: string } | null>) => ({
  id: `timetable-${term}`,
  term_id: term,
  coverage: 'complete',
  review_status: 'reviewed',
  offerings: ['ZZ 201', 'ZZ 310', 'ZZ 201B'].map((code) => ({ id: `${term}:${code}`, code, meeting_groups: [], course_plan_link: links[code] ?? null })),
});

function server() {
  return fakeApi({
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
    'GET /offerings?term_id=2026-27-I': () => ({ data: snapshot('2026-27-I', { 'ZZ 201': { target: ZZ201, display_text: 'ZZ 201 course plan', locator: 'Time table!N5' }, 'ZZ 310': null }) }),
    'GET /offerings?term_id=2027-28-I': () => ({ data: snapshot('2027-28-I', {}) }),
    'GET /plans': () => ({ data: [] }),
    'POST /plans/generate': () => ({ data: generationExample.data, issues: generationExample.issues }),
    'POST /plans/check': () => ({ data: check }),
  });
}

describe('Course plan link in the generated draft (CP-43)', () => {
  it('links a course that has a course plan and says "not available yet" for one that has none, in the draft table', async () => {
    const api = server();
    renderApp(<PlanIndexPage />, { fetchImpl: api.fetchImpl, route: '/plan', path: '/plan' });
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    const first = await within(draft).findByRole('region', { name: /Draft 2026.27 Semester I/ });
    const zz201 = (await within(first).findByText('ZZ 201')).closest('tr') as HTMLElement;
    const link = await within(zz201).findByRole('link', { name: /Course plan.*ZZ 201/ });
    expect(link).toHaveAttribute('href', ZZ201);
    expect(link).toHaveAttribute('target', '_blank');
    const zz310 = (await within(first).findByText('ZZ 310')).closest('tr') as HTMLElement;
    expect(await within(zz310).findByText('Course plan not available yet')).toBeInTheDocument();
    const later = await within(draft).findByRole('region', { name: /Draft 2027.28 Semester I/ });
    const zz201b = (await within(later).findByText('ZZ 201B')).closest('tr') as HTMLElement;
    expect(await within(zz201b).findByText('Course plan not available yet')).toBeInTheDocument();
  });

  it('asks for the timetable of each semester once, however many courses it has', async () => {
    const api = server();
    renderApp(<PlanIndexPage />, { fetchImpl: api.fetchImpl, route: '/plan', path: '/plan' });
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    const first = await within(draft).findByRole('region', { name: /Draft 2026.27 Semester I/ });
    await within(first).findByRole('link', { name: /Course plan.*ZZ 201/ });
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/offerings?term_id=2026-27-I')).toHaveLength(1));
  });
});
