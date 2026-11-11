/** "With my plan" counts the credits a plan keeps in placeholders and says which placeholder keeps them (CP-40, D-53); "Completed + current
 * courses" lets the student add the courses they are taking now (CP-41). Every number is the server's. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult, PlanHolds } from '../../api/types';
import { analysis, catalogue, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { RequirementsPage } from './RequirementsPage';

const holds: PlanHolds = {
  degree: { total_credits: '170', counted_credits: '124', held_credits: '8', remaining_credits: '46' },
  requirements: {
    hss: { held_credits: '4', placeholders: [] },
    ge: { held_credits: '4', placeholders: [{ id: 'p1', label: 'GE elective', desired_credits: '4', term_id: '2026-27-II', online: false }] },
    'cse-electives': { held_credits: '4', placeholders: [] },
    'cse-general': { held_credits: '4', placeholders: [{ id: 'p2', label: 'Online course', desired_credits: '4', term_id: '2026-27-SUMMER', online: true }] },
  },
};
const withHolds: AnalysisResult = { ...analysis, plan_holds: holds };

const routes = (data: AnalysisResult = withHolds) => ({
  'GET /curricula/cse-2024': () => ({ data: curriculum, issues: [issue('SOURCE_MISSING', 'unknown', [], 'Only a draft is available.')] }),
  'GET /catalogue': () => ({ data: catalogue, issues: [] }),
  'GET /record': () => ({ data: record }),
  'GET /plans': () => ({ data: [plan] }),
  'POST /analysis': () => ({ data, issues: data.audit.issues }),
});

async function openPlanView(api = fakeApi(routes())) {
  renderApp(<RequirementsPage />, { fetchImpl: api.fetchImpl });
  await screen.findByRole('region', { name: 'Overview' });
  await userEvent.click(screen.getByRole('radio', { name: 'With my plan' }));
  return api;
}

describe('With my plan: placeholders count (CP-40)', () => {
  it('shows the total and the credits remaining with the placeholders counted, and says how much they keep', async () => {
    await openPlanView();
    const overview = await screen.findByRole('region', { name: 'Overview' });
    await waitFor(() => expect(within(overview).getByText('Credits counted').parentElement).toHaveTextContent('124 of 170'));
    expect(within(overview).getByText('Credits remaining').parentElement).toHaveTextContent('46');
    expect(within(overview).getByText('Kept in placeholders').parentElement).toHaveTextContent('8');
    expect(within(overview).getByRole('status')).toHaveTextContent('Your plan leaves 46 credits uncovered');
    expect(within(overview).getByText(/8 of the credits counted are kept in placeholders: you still choose the courses for them/)).toBeInTheDocument();
    expect(within(overview).queryByText(/116 of 170/)).not.toBeInTheDocument(); // the plan's courses alone, without the placeholders
  });

  it('a requirement says it keeps credits in placeholders, and opening it names the placeholder', async () => {
    await openPlanView();
    const list = screen.getByRole('list', { name: 'Requirements' });
    const group = within(list).getByRole('button', { name: /^HSS \(GE included\)/ });
    expect(group).toHaveTextContent('4 credits kept in placeholders');
    await userEvent.click(group);
    const ge = list.querySelector('[data-requirement="ge"]') as HTMLElement;
    expect(within(ge).getByRole('button')).toHaveTextContent('4 credits kept in placeholders');
    await userEvent.click(within(ge).getByRole('button'));
    expect(within(ge).getByRole('heading', { name: 'Placeholder kept' })).toBeInTheDocument();
    expect(within(ge).getByText(/4 credits in 2026–27 Semester II: GE elective — you still choose the course\./)).toBeInTheDocument();
  });

  it('marks an online placeholder as online', async () => {
    await openPlanView();
    const list = screen.getByRole('list', { name: 'Requirements' });
    await userEvent.click(within(list).getByRole('button', { name: /^Cse electives/ }));
    const general = list.querySelector('[data-requirement="cse-general"]') as HTMLElement;
    await userEvent.click(within(general).getByRole('button'));
    expect(within(general).getByText(/4 credits in 2026–27 Summer: Online course \(online\)/)).toBeInTheDocument();
  });

  it('says nothing about placeholders in the completed and current views', async () => {
    await openPlanView();
    await userEvent.click(screen.getByRole('radio', { name: 'Completed' }));
    expect(screen.queryByText(/kept in placeholders/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Completed + current courses' }));
    expect(screen.queryByText(/kept in placeholders/)).not.toBeInTheDocument();
  });

  it('a plan with no placeholders shows the plain total and no placeholder line', async () => {
    const none: AnalysisResult = { ...analysis, plan_holds: { degree: { total_credits: '170', counted_credits: '116', held_credits: '0', remaining_credits: '54' }, requirements: {} } };
    await openPlanView(fakeApi(routes(none)));
    const overview = await screen.findByRole('region', { name: 'Overview' });
    await waitFor(() => expect(within(overview).getByText('Credits counted').parentElement).toHaveTextContent('116 of 170'));
    expect(within(overview).queryByText('Kept in placeholders')).not.toBeInTheDocument();
  });
});

describe('Placeholder wording follows what the server counted (CP-40, review)', () => {
  const only = (requirements: PlanHolds['requirements'], held = '4'): AnalysisResult => ({
    ...analysis,
    plan_holds: { degree: { total_credits: '170', counted_credits: '108', held_credits: held, remaining_credits: '62' }, requirements },
  });

  it('does not say a placeholder is kept where the server counted none of it', async () => {
    // A placeholder aimed at a requirement that is already met keeps nothing: held 0, but the placeholder is still listed by the server.
    const data = only({ ge: { held_credits: '0', placeholders: [{ id: 'p1', label: 'GE elective', desired_credits: '4', term_id: '2026-27-II', online: false }] } }, '0');
    await openPlanView(fakeApi(routes(data)));
    const list = screen.getByRole('list', { name: 'Requirements' });
    await userEvent.click(within(list).getByRole('button', { name: /^HSS \(GE included\)/ }));
    const ge = list.querySelector('[data-requirement="ge"]') as HTMLElement;
    expect(ge).not.toHaveTextContent(/kept in placeholders/);
    await userEvent.click(within(ge).getByRole('button'));
    expect(within(ge).queryByRole('heading', { name: 'Placeholder kept' })).not.toBeInTheDocument();
  });

  it('says when a placeholder keeps less than it asks for (the requirement can take no more)', async () => {
    const data = only({ ge: { held_credits: '4', placeholders: [{ id: 'p1', label: 'GE elective', desired_credits: '10', term_id: '2026-27-II', online: false }] } });
    await openPlanView(fakeApi(routes(data)));
    const list = screen.getByRole('list', { name: 'Requirements' });
    await userEvent.click(within(list).getByRole('button', { name: /^HSS \(GE included\)/ }));
    const ge = list.querySelector('[data-requirement="ge"]') as HTMLElement;
    await userEvent.click(within(ge).getByRole('button'));
    expect(within(ge).getByText(/4 credits are counted here: a placeholder keeps no more than this requirement can still take/)).toBeInTheDocument();
    expect(within(ge).getByText(/10 credits in 2026–27 Semester II/)).toBeInTheDocument();
  });
});

describe('Completed + current courses: add the courses of the running semester (CP-41)', () => {
  it('shows the current courses panel only in that view', async () => {
    renderApp(<RequirementsPage />, { fetchImpl: fakeApi(routes()).fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    expect(screen.queryByRole('region', { name: 'Your current courses' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Completed + current courses' }));
    expect(screen.getByRole('region', { name: 'Your current courses' })).toBeInTheDocument();
  });

  it('adds a confirmed current course, saves it with the record revision and counts again with the new revision', async () => {
    let current = structuredClone(record);
    const patches: unknown[] = [];
    const analysisRevisions: number[] = [];
    const base = routes();
    const api = fakeApi({
      ...base,
      'GET /record': () => ({ data: current }),
      'PATCH /record': (req) => {
        patches.push(req.body);
        const body = req.body as { current_enrolment: typeof current.current_enrolment };
        current = { ...current, revision: current.revision + 1, current_enrolment: body.current_enrolment };
        return { data: current };
      },
      'POST /analysis': (req) => {
        analysisRevisions.push((req.body as { record_revision: number }).record_revision);
        return { data: withHolds, issues: [] };
      },
    });
    renderApp(<RequirementsPage />, { fetchImpl: api.fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    await userEvent.click(screen.getByRole('radio', { name: 'Completed + current courses' }));
    const form = screen.getByRole('form', { name: 'Add current course' });
    await userEvent.type(within(form).getByLabelText('Course code'), 'ZZ 330');
    await userEvent.type(within(form).getByLabelText('Credits'), '4');
    await userEvent.clear(within(form).getByLabelText('Term'));
    await userEvent.type(within(form).getByLabelText('Term'), '2026-27-I');
    await userEvent.click(within(form).getByRole('checkbox'));
    await userEvent.click(within(form).getByRole('button', { name: 'Add to current enrolment' }));
    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 3000 });
    expect(patches[0]).toMatchObject({ expected_revision: record.revision, current_enrolment: [expect.objectContaining({ normalized_code: 'ZZ 330', term_id: '2026-27-I', credits: '4', confirmed: true })] });
    await waitFor(() => expect(analysisRevisions).toContain(record.revision + 1), { timeout: 3000 }); // the requirements are counted again with the new record
  });

  it('keeps the page and the typed text while the count is redone after a save, and lists the course under its requirement', async () => {
    let current = structuredClone(record);
    let enrolmentId = '';
    let analyses = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const base = routes();
    const api = fakeApi({
      ...base,
      'GET /record': () => ({ data: current }),
      'PATCH /record': (req) => {
        const body = req.body as { current_enrolment: typeof current.current_enrolment };
        enrolmentId = body.current_enrolment[0]!.id;
        current = { ...current, revision: current.revision + 1, current_enrolment: body.current_enrolment };
        return { data: current };
      },
      'POST /analysis': async () => {
        analyses += 1;
        if (analyses === 1) return { data: withHolds, issues: [] };
        await gate; // the count with the new record is slow
        const allocation = { ...analysis.audit.ledger[0], id: 'allocation:cur:dsa', attempt_id: enrolmentId, counting_context: 'current' as const };
        const currentTree = analysis.audit.current.map((n) => (n.id === 'cse-core' ? { ...n, children: (n.children ?? []).map((c) => (c.id === 'dsa' ? { ...c, allocation_ids: [allocation.id] } : c)) } : n));
        return { data: { ...withHolds, audit: { ...analysis.audit, current: currentTree, current_ledger: [allocation] } }, issues: [] };
      },
    });
    renderApp(<RequirementsPage />, { fetchImpl: api.fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    await userEvent.click(screen.getByRole('radio', { name: 'Completed + current courses' }));
    const form = screen.getByRole('form', { name: 'Add current course' });
    await userEvent.type(within(form).getByLabelText('Course code'), 'ZZ 330');
    await userEvent.type(within(form).getByLabelText('Credits'), '4');
    await userEvent.clear(within(form).getByLabelText('Term'));
    await userEvent.type(within(form).getByLabelText('Term'), '2026-27-I');
    await userEvent.click(within(form).getByRole('checkbox'));
    await userEvent.click(within(form).getByRole('button', { name: 'Add to current enrolment' }));
    await waitFor(() => expect(analyses).toBe(2), { timeout: 3000 }); // the new count has started and is held back
    // The student starts the next course while it loads: the form, the overview and the tree are all still there, and the typed text stays.
    const next = screen.getByRole('form', { name: 'Add current course' });
    await userEvent.type(within(next).getByLabelText('Course code'), 'ZZ 331');
    expect(within(next).getByLabelText('Course code')).toHaveValue('ZZ 331');
    expect(within(next).getByLabelText('Course code')).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Requirements' })).toBeInTheDocument();
    expect(screen.queryByText('Checking your record…')).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByText('Updating the count…')).not.toBeInTheDocument(), { timeout: 3000 });
    await userEvent.click(within(screen.getByRole('list', { name: 'Requirements' })).getByRole('button', { name: /^Cse core/ }));
    await waitFor(() => expect(screen.getByText(/counted: ZZ 330/)).toBeInTheDocument(), { timeout: 3000 });
  });

  it('does not show the panel to a visitor who is not signed in', async () => {
    const api = fakeApi({ 'GET /curricula/cse-2024': () => ({ data: curriculum, issues: [] }), 'GET /catalogue': () => ({ data: catalogue, issues: [] }) }, null);
    renderApp(<RequirementsPage />, { fetchImpl: api.fetchImpl });
    await screen.findByRole('heading', { level: 1, name: 'Graduation requirements' });
    expect(screen.queryByRole('region', { name: 'Your current courses' })).not.toBeInTheDocument();
  });
});
