/**
 * CP-43: a course in a planned semester links to its course plan (the course outline the instructor publishes), taken from the
 * official timetable of that semester. When the timetable has no link for the course, the row says the course plan is not available
 * yet. The student never sees a broken link, and a link that is not an ordinary web address is not offered.
 *
 * Snapshot data comes from examples/offerings.json (PH 202 and ES 667); each test sets `course_plan_link` on a copy, spelling out the
 * shape the importer produces (coursepath/data_sources/timetable_xlsx.py: `{target, display_text, locator}`, `target: null` when the
 * cell has text but no hyperlink, the whole link `null` when the cell is empty). The wording avoids "published": the planner never
 * shows a "not published" state for a timetable (D-38, D-39).
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import offeringsExample from '../../../../examples/offerings.json';
import type { AcademicPlan, CourseOffering, PlanValidation, TermOfferingSnapshot } from '../../api/types';
import { curriculum, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { PlanPage } from './PlanPage';

const TERM = '2026-27-I';
const PH_PLAN = 'https://example.org/course-plans/ph202.docx';
const OTHER_PLAN = 'https://example.org/course-plans/ph202-section-b.docx';

const example = offeringsExample.data as unknown as TermOfferingSnapshot;
type Link = { target: string | null; display_text: string | null; locator: string } | null;

function snapshotWith(links: Record<string, Link>, extra: CourseOffering[] = []): TermOfferingSnapshot {
  const copy = structuredClone(example);
  for (const o of copy.offerings) (o as CourseOffering & { course_plan_link?: Link }).course_plan_link = links[o.code] ?? null;
  copy.offerings.push(...extra);
  return copy;
}
const link = (target: string | null, text = 'Course plan'): Link => ({ target, display_text: text, locator: 'Time table!N10' });

const planOf = (courses: AcademicPlan['semesters'][number]['courses']): AcademicPlan => ({ id: 'plan-1', revision: 1, label: 'Main plan', semesters: [{ term_id: TERM, courses, placeholders: [] }] });

function server(plan: AcademicPlan, snapshot: unknown | 'error') {
  const validate = (p: AcademicPlan): PlanValidation => ({
    workload: Object.fromEntries(p.semesters.map((s) => [s.term_id, { selected_credits: '8', placeholder_credits: '0', target_credits: '8' }])),
    per_course: p.semesters.flatMap((s) => s.courses.map((c) => ({ id: c.id, term_id: s.term_id, eligibility: 'unknown' as const, offering_status: 'confirmed_in_snapshot', meeting_check_status: 'not_checked' }))),
    issues: [],
    meeting_check_status: 'not_checked',
    meeting_checks: {},
    completion_term: null,
  });
  const api = fakeApi({
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'unknown', review_status: 'draft' } }),
    'GET /plans/:id': () => ({ data: plan }),
    'POST /plans/:id/validate': () => ({ data: validate(plan) }),
    [`GET /offerings?term_id=${TERM}`]: () => (snapshot === 'error' ? { status: 500, data: null } : { data: snapshot }),
  });
  return api.fetchImpl;
}

const render = (plan: AcademicPlan, snapshot: unknown | 'error') => renderApp(<PlanPage />, { fetchImpl: server(plan, snapshot), route: '/plan/plan-1', path: '/plan/:plan_id' });
const rowOf = async (code: string) => {
  const semester = await screen.findByRole('region', { name: '2026–27 Semester I' });
  return (await within(semester).findByText(code)).closest('tr') as HTMLElement;
};
const ph = { id: 'c-ph', normalized_code: 'PH 202', credits: '4' };
const es = { id: 'c-es', normalized_code: 'ES 667', credits: '4' };

describe('Course plan link in a planned semester (CP-43)', () => {
  it('a course the timetable gives a course plan for links to it, opening in a new tab', async () => {
    render(planOf([ph]), snapshotWith({ 'PH 202': link(PH_PLAN) }));
    const row = await rowOf('PH 202');
    const a = await within(row).findByRole('link', { name: /Course plan.*PH 202/ });
    expect(a).toHaveAttribute('href', PH_PLAN);
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toMatch(/noopener/);
    expect(row).not.toHaveTextContent(/not available/i);
  });

  it('shows each course its own link or its own "not available yet", never one taken from another course', async () => {
    render(planOf([ph, es]), snapshotWith({ 'PH 202': link(PH_PLAN), 'ES 667': null }));
    const phRow = await rowOf('PH 202');
    const esRow = await rowOf('ES 667');
    await within(phRow).findByRole('link', { name: /Course plan.*PH 202/ });
    expect(within(esRow).getByText('Course plan not available yet')).toBeInTheDocument();
    expect(within(esRow).queryByRole('link', { name: /Course plan/ })).not.toBeInTheDocument();
    expect(within(phRow).queryByText(/not available yet/)).not.toBeInTheDocument();
  });

  it('the timetable cell had text but no hyperlink: not available yet, and no link', async () => {
    render(planOf([es]), snapshotWith({ 'ES 667': link(null, 'ES 667 Course Plan') }));
    const row = await rowOf('ES 667');
    expect(await within(row).findByText('Course plan not available yet')).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: /Course plan/ })).not.toBeInTheDocument();
  });

  it('a link that is not an ordinary web address is never offered', async () => {
    render(planOf([ph, es]), snapshotWith({ 'PH 202': link('javascript:alert(1)'), 'ES 667': link('data:text/html,<p>x</p>') }));
    for (const code of ['PH 202', 'ES 667']) {
      const row = await rowOf(code);
      expect(await within(row).findByText('Course plan not available yet')).toBeInTheDocument();
      expect(within(row).queryByRole('link', { name: /Course plan/ })).not.toBeInTheDocument();
    }
  });

  it('a course the timetable does not list at all is not available yet', async () => {
    render(planOf([{ id: 'c-x', normalized_code: 'ZZ 330', credits: '4' }]), snapshotWith({ 'PH 202': link(PH_PLAN) }));
    const row = await rowOf('ZZ 330');
    expect(await within(row).findByText('Course plan not available yet')).toBeInTheDocument();
  });

  it('with two timetable versions of a course, the link of the chosen version is used', async () => {
    const second = { ...structuredClone(example.offerings.find((o) => o.code === 'PH 202')!), id: '2026-27-I:PH202:B', raw_label: 'PH 202 (B)', course_plan_link: link(OTHER_PLAN) } as CourseOffering;
    const chosen = { ...ph, offering_id: '2026-27-I:PH202:B' };
    render(planOf([chosen]), snapshotWith({ 'PH 202': link(PH_PLAN) }, [second]));
    const row = await rowOf('PH 202');
    expect(await within(row).findByRole('link', { name: /Course plan.*PH 202/ })).toHaveAttribute('href', OTHER_PLAN);
  });

  it('says nothing while the timetable is loading or when it could not be loaded, instead of claiming the course plan is missing', async () => {
    render(planOf([ph]), 'error');
    const row = await rowOf('PH 202');
    await waitFor(() => expect(screen.getByText(/could not be loaded/)).toBeInTheDocument());
    expect(row).not.toHaveTextContent(/Course plan/);
  });
});

describe('Course plan link when the chosen version names another semester (CP-43, review)', () => {
  it('a version chosen for another term (D-51) is ignored, so the course still links to the course plan of its own semester', async () => {
    const stale = { ...ph, offering_id: '2025-26-II:PH202' };
    render(planOf([stale]), snapshotWith({ 'PH 202': link(PH_PLAN) }));
    const row = await rowOf('PH 202');
    expect(await within(row).findByRole('link', { name: /Course plan.*PH 202/ })).toHaveAttribute('href', PH_PLAN);
    expect(row).not.toHaveTextContent(/not available/i);
  });
});
