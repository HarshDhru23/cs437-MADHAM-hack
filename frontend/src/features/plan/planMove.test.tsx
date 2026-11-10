/** Moving a planned course (CP-39, D-50, D-51): odd semester to odd, even to even, summer to summer; and the section chosen for the old
 * term does not travel with the course, which made the new term report an error although the course is offered there. Online courses
 * are shown beside a semester's load, not in it. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AcademicPlan, PlanPayload, PlanValidation } from '../../api/types';
import { curriculum, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { moveTargets, termKind } from '../../lib/terms';
import { PlanPage } from './PlanPage';

const start: AcademicPlan = {
  id: 'plan-1',
  revision: 2,
  label: 'Main plan',
  semesters: [
    { term_id: '2026-27-I', courses: [{ id: 'c-os', normalized_code: 'CS 330', credits: '4', offering_id: '2026-27-I:CS330', section_ids: ['2026-27-I:CS330:lecture:H2'] }], placeholders: [] },
    { term_id: '2026-27-II', courses: [{ id: 'c-net', normalized_code: 'CS 331', credits: '4' }], placeholders: [] },
    { term_id: '2026-27-SUMMER', courses: [], placeholders: [{ id: 'o1', requirement_id: 'open-electives', desired_credits: '4', label: 'Online course', online: true }] },
    { term_id: '2027-28-I', courses: [], placeholders: [] },
    { term_id: '2027-28-II', courses: [], placeholders: [] },
  ],
};

function server(workload: Record<string, unknown> = {}) {
  let current: AcademicPlan = structuredClone(start);
  const patches: (PlanPayload & { expected_revision: number })[] = [];
  const validation = (): PlanValidation =>
    ({
      workload: Object.fromEntries(current.semesters.map((s) => [s.term_id, { selected_credits: '4', placeholder_credits: '0', target_credits: '4', ...(workload[s.term_id] as object | undefined) }])),
      per_course: [],
      issues: [],
      meeting_check_status: 'not_checked',
      completion_term: null,
    }) as PlanValidation;
  const api = fakeApi({
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
    'GET /plans/:id': () => ({ data: current }),
    'POST /plans/:id/validate': () => ({ data: validation() }),
    'POST /plans/check': () => ({
      data: {
        validation: validation(),
        degree: { total_credits: '170', counted_credits: '100', remaining_credits: '70' },
        placeholder_credits: '0',
        uncovered_credits: '70',
        requirements: [],
        online: { planned_credits: '0', counted_credits: '0' },
        load: {},
        status: { valid: false, problems: 0, uncovered_credits: '70' },
      },
    }),
    'PATCH /plans/:id': (req) => {
      const body = req.body as PlanPayload & { expected_revision: number };
      patches.push(body);
      current = { id: current.id, revision: current.revision + 1, label: body.label, semesters: body.semesters };
      return { data: { ...current, validation: validation() } };
    },
  });
  return { ...api, patches };
}

const render = (s: ReturnType<typeof server>) => renderApp(<PlanPage />, { fetchImpl: s.fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });
const semester = (name: string) => screen.getByRole('region', { name });

describe('moveTargets', () => {
  it('lists the term itself and the other terms of the same kind only', () => {
    const all = ['2026-27-I', '2026-27-II', '2026-27-SUMMER', '2027-28-I', '2027-28-II', '2027-28-SUMMER'];
    expect(moveTargets('2026-27-I', all)).toEqual(['2026-27-I', '2027-28-I']);
    expect(moveTargets('2026-27-II', all)).toEqual(['2026-27-II', '2027-28-II']);
    expect(moveTargets('2026-27-SUMMER', all)).toEqual(['2026-27-SUMMER', '2027-28-SUMMER']);
    expect(termKind('not a term')).toBeNull();
    expect(moveTargets('not a term', all)).toEqual([]);
  });
});

describe('Moving a planned course', () => {
  it('offers only the odd semesters for a course in an odd semester', async () => {
    render(server());
    await screen.findByRole('region', { name: '2026–27 Semester I' });
    const select = within(semester('2026–27 Semester I')).getByLabelText('Move CS 330 to');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026–27 Semester I', '2027–28 Semester I']);
  });

  it('offers only the even semesters for a course in an even semester', async () => {
    render(server());
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    const select = within(semester('2026–27 Semester II')).getByLabelText('Move CS 331 to');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026–27 Semester II', '2027–28 Semester II']);
  });

  it('does not carry the old semester\'s section choice to the new one', async () => {
    const s = server();
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester I' });
    await userEvent.selectOptions(within(semester('2026–27 Semester I')).getByLabelText('Move CS 330 to'), '2027-28-I');
    await userEvent.click(within(semester('2026–27 Semester I')).getByRole('button', { name: 'Move CS 330' }));
    await waitFor(() => expect(s.patches).toHaveLength(1), { timeout: 3000 });
    const moved = s.patches[0]!.semesters.find((x) => x.term_id === '2027-28-I')!.courses[0]!;
    expect(moved).toMatchObject({ id: 'c-os', normalized_code: 'CS 330', credits: '4' });
    expect(moved).not.toHaveProperty('offering_id');
    expect(moved).not.toHaveProperty('section_ids');
  });

  it('says that a course moves between odd semesters or between even ones', async () => {
    render(server());
    expect(await screen.findByText(/another odd semester, or to another even semester/)).toBeInTheDocument();
  });
});

describe('Online credits beside the load', () => {
  it('names the online credits a semester holds as outside its limit, from the server\'s numbers', async () => {
    render(server({ '2026-27-I': { online_credits: '6', target_credits: '4' } }));
    const sem = await screen.findByRole('region', { name: '2026–27 Semester I' });
    await waitFor(() => expect(within(sem).getByText(/plus 6 online credits, outside this limit/)).toBeInTheDocument());
    expect(within(sem).getByText(/Semester total: 4 \/ 28 credits/)).toBeInTheDocument();
  });
});
