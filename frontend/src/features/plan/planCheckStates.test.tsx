import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import checkExample from '../../../../examples/plan-check.json';
import type { AcademicPlan, PlanCheck, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { PlanPage } from './PlanPage';

/**
 * CR-75, CR-71 (CP-29, CP-35): what the plan page says while a save is stuck, and when the re-check after an edit fails. A fake server keeps the
 * saved plan; the first /plans/check answers, later ones follow `checkFrom`.
 */
const DUPLICATE = issue('DUPLICATE_COURSE', 'error', ['c-os'], 'Synthetic duplicate on ZZ 330.');

function validation(p: AcademicPlan): PlanValidation {
  return {
    workload: Object.fromEntries(p.semesters.map((s) => [s.term_id, { selected_credits: '4', placeholder_credits: '0', target_credits: '4' }])),
    per_course: [],
    issues: [DUPLICATE as PlanValidation['issues'][number]],
    meeting_check_status: 'not_checked',
    completion_term: null,
  };
}

function server(opts: { patch?: 'offline' | 'ok'; checkFrom?: (call: number) => { status?: number } | null } = {}) {
  let current: AcademicPlan = structuredClone(plan);
  let checks = 0;
  const timetables = Object.fromEntries(
    ['2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II'].map((term) => [
      `GET /offerings?term_id=${term}`,
      () => ({ data: { id: null, term_id: term, coverage: 'unknown', review_status: null, offerings: [], slot_map: {}, source_refs: [] } }),
    ]),
  );
  const api = fakeApi({
    ...timetables,
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
    'GET /plans/:id': () => ({ data: current }),
    'POST /plans/:id/validate': () => ({ data: validation(current) }),
    'POST /plans/check': () => {
      checks += 1;
      const failure = checks > 1 ? opts.checkFrom?.(checks) : null;
      if (failure) {
        const conflict = failure.status === 409;
        return { status: failure.status ?? 500, data: conflict ? { current_revision: record.revision + 1, action: 'reload_compare' } : null, issues: [issue(conflict ? 'REVISION_CONFLICT' : 'SERVER_ERROR', 'error')] };
      }
      return { data: { ...(checkExample.data as unknown as PlanCheck), uncovered_credits: String(checks === 1 ? 46 : 30) } };
    },
    'PATCH /plans/:id': (req) => {
      if (opts.patch === 'offline') throw new TypeError('Failed to fetch');
      const body = req.body as { label: string; semesters: AcademicPlan['semesters'] };
      current = { id: current.id, revision: current.revision + 1, label: body.label, semesters: body.semesters };
      return { data: { ...current, validation: validation(current) } };
    },
  });
  return api;
}

const render = (s: ReturnType<typeof server>) => renderApp(<PlanPage />, { fetchImpl: s.fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });
const semester = (term: string) => screen.getByRole('region', { name: term });
const removeCourse = () => userEvent.click(within(semester('2026–27 Semester II')).getByRole('button', { name: 'Remove ZZ 331' }));
const panel = () => screen.getByRole('region', { name: 'Plan validation' });
const DUPLICATE_TEXT = 'ZZ 330 is already in your plan or already completed.';

describe('a save that cannot be sent (CR-75)', () => {
  it('does not claim to be checking when the save failed, and keeps the last known problems, marked as out of date', async () => {
    const s = server({ patch: 'offline' });
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    await waitFor(() => expect(within(panel()).getByText(DUPLICATE_TEXT)).toBeInTheDocument());
    await removeCourse();
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Offline'), { timeout: 3000 });
    expect(panel()).not.toHaveTextContent(/Checking your latest changes/); // nothing is being checked: the save is stuck
    expect(within(panel()).getByText(DUPLICATE_TEXT)).toBeInTheDocument(); // the error the student already knows about is still shown
    expect(panel()).toHaveTextContent(/describe the last version that was saved/i);
  });

  it('says it is checking while the save is still on its way', async () => {
    // Negative: the "checking" line belongs to a save or check that is in flight.
    const s = server({ patch: 'ok' });
    render(s);
    await screen.findByRole('region', { name: '2026–27 Semester II' });
    await waitFor(() => expect(within(panel()).getByText(DUPLICATE_TEXT)).toBeInTheDocument());
    await removeCourse();
    expect(panel()).toHaveTextContent(/Checking your latest changes/);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Plan save status' })).toHaveTextContent('Saved'), { timeout: 3000 });
    expect(panel()).not.toHaveTextContent(/Checking your latest changes/);
  });
});

describe('a re-check that fails after an edit (CR-71)', () => {
  it('tells the student the credits left may be out of date when the record changed elsewhere (409)', async () => {
    const s = server({ patch: 'ok', checkFrom: () => ({ status: 409 }) });
    render(s);
    const progress = await screen.findByRole('region', { name: 'Your plan so far' });
    await waitFor(() => expect(within(progress).getByText('46 credits left for graduation')).toBeInTheDocument());
    await removeCourse();
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(/record was saved elsewhere/i);
    expect(alert).toHaveTextContent(/out of date/i);
    expect(alert).not.toHaveTextContent(/REVISION_CONFLICT/);
    expect(within(progress).getByText('46 credits left for graduation')).toBeInTheDocument(); // the old number stays visible, but is marked
    expect(progress).toHaveAttribute('data-stale', 'true');
  });

  it('shows the error and a Try again button when the check fails, and clears both when it works again', async () => {
    const s = server({ patch: 'ok', checkFrom: (call) => (call === 2 ? { status: 500 } : null) });
    render(s);
    const progress = await screen.findByRole('region', { name: 'Your plan so far' });
    await waitFor(() => expect(within(progress).getByText('46 credits left for graduation')).toBeInTheDocument());
    await removeCourse();
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(/could not be checked|out of date/i);
    expect(progress).toHaveAttribute('data-stale', 'true');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(progress).getByText('30 credits left for graduation')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(progress).not.toHaveAttribute('data-stale');
  });

  it('shows no notice and no stale mark when every check works', async () => {
    const s = server({ patch: 'ok' });
    render(s);
    const progress = await screen.findByRole('region', { name: 'Your plan so far' });
    await waitFor(() => expect(within(progress).getByText('46 credits left for graduation')).toBeInTheDocument());
    await removeCourse();
    await waitFor(() => expect(within(progress).getByText('30 credits left for graduation')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(progress).not.toHaveAttribute('data-stale');
  });
});
