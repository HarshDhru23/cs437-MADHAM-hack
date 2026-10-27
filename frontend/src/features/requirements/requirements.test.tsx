import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { analysis, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { RequirementsPage } from './RequirementsPage';

const publicRoutes = { 'GET /curricula/cse-2024': () => ({ data: curriculum, issues: [issue('SOURCE_MISSING', 'unknown', [], 'Only a draft is available.')] }) };

describe('RequirementsPage — public mode (CP-01)', () => {
  it('shows every requirement grouped by basket before any history or sign-in', async () => {
    const { fetchImpl, calls } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('heading', { name: 'CSE 2024 graduation requirements' });
    const list = screen.getByRole('list', { name: 'Requirements' });
    for (const label of ['HSS (GE included)', 'Science basket', 'Bs elective', 'Cse core', 'Cse electives']) {
      expect(within(list).getByRole('heading', { name: label })).toBeInTheDocument();
    }
    // GE is inside HSS; electives' sub-baskets inside the elective parent; core separate.
    const hss = within(list).getByRole('heading', { name: 'HSS (GE included)' }).closest('li') as HTMLElement;
    expect(within(hss).getByRole('heading', { name: 'Ge' })).toBeInTheDocument();
    expect(within(hss).getByText(/Choose at least 2 courses/)).toBeInTheDocument();
    const electives = within(list).getByRole('heading', { name: 'Cse electives' }).closest('li') as HTMLElement;
    expect(within(electives).getByRole('heading', { name: 'Theory' })).toBeInTheDocument();
    const core = within(list).getByRole('heading', { name: 'Cse core' }).closest('li') as HTMLElement;
    expect(within(core).queryByRole('heading', { name: 'Theory' })).not.toBeInTheDocument();
    expect(within(core).getByText(/Mandatory course CS 202/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/record' || c.path === '/analysis')).toBe(false);
  });

  it('makes the draft status and missing sources prominent', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    expect(await screen.findByText(/These rules are a draft/)).toBeInTheDocument();
    expect(screen.getByText('Equivalence/substitution decisions')).toBeInTheDocument();
    expect(screen.getByText('Only a draft is available.')).toBeInTheDocument();
  });

  it('shows zero-credit PE/viva obligations with unknown completion policy, not as complete', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const section = await screen.findByRole('region', { name: 'Non-credit obligations' });
    expect(within(section).getByText(/4 semesters/)).toBeInTheDocument();
    expect(within(section).getAllByText(/Completion policy not yet reviewed/)).toHaveLength(2);
    expect(within(section).queryByText(/Satisfied|Complete\b/)).not.toBeInTheDocument();
  });

  it('opens a source explanation from Why?', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    await userEvent.click(await screen.findByRole('button', { name: 'Why? Cse core' }));
    const dialog = screen.getByRole('dialog', { name: /Cse core/ });
    expect(within(dialog).getByText(/Committed implementation roadmap/)).toBeInTheDocument();
    expect(within(dialog).getByText(/review status: draft/)).toBeInTheDocument();
  });
});

const personalRoutes = {
  ...publicRoutes,
  'GET /record': () => ({ data: record }),
  'GET /plans': () => ({ data: [plan] }),
  'POST /analysis': () => ({ data: analysis, issues: analysis.audit.issues }),
};

describe('RequirementsPage — stale record (CP-29)', () => {
  it('after a 409 from analysis, "Try again" reloads the record and asks with its current revision', async () => {
    // Another tab saves right after this tab read the record: the first read is revision 3, the server is at 4.
    let recordReads = 0;
    const analysisRevisions: number[] = [];
    const { fetchImpl } = fakeApi({
      ...publicRoutes,
      'GET /record': () => ({ data: { ...record, revision: recordReads++ === 0 ? 3 : 4 } }),
      'GET /plans': () => ({ data: [plan] }),
      'POST /analysis': (req) => {
        const asked = (req.body as { record_revision: number }).record_revision;
        analysisRevisions.push(asked);
        if (asked !== 4) return { status: 409, data: { current_revision: 4, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error', [], 'The record changed since it was loaded.')] };
        return { data: { ...analysis, record_revision: 4 }, issues: analysis.audit.issues };
      },
    });
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByText('Saved elsewhere');
    expect(analysisRevisions).toEqual([3]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: 'Overview' });
    // The record was read again and the successful evaluation used its current revision.
    expect(recordReads).toBeGreaterThanOrEqual(2);
    expect(analysisRevisions.at(-1)).toBe(4);
    expect(screen.queryByText('Saved elsewhere')).not.toBeInTheDocument();
  });
});

describe('RequirementsPage — personal audit (CP-03, CP-13, CP-20)', () => {
  it('shows server statuses; a full progress bar never turns needs-review into satisfied', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    const list = screen.getByRole('list', { name: 'Requirements' });
    const electives = (await within(list).findByRole('heading', { name: 'Cse electives' })).closest('li') as HTMLElement;
    expect(within(electives).getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(within(electives).queryByText('Satisfied')).not.toBeInTheDocument();
    const dsa = within(list).getByRole('heading', { name: 'Dsa' }).closest('li') as HTMLElement;
    expect(within(dsa).getByText('Satisfied')).toBeInTheDocument();
  });

  it('expands to list counted attempts from the allocation ledger, with explanation', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    const list = screen.getByRole('list', { name: 'Requirements' });
    const dsa = (await within(list).findByRole('heading', { name: 'Dsa' })).closest('li') as HTMLElement;
    await userEvent.click(within(dsa).getByRole('button', { name: 'Details for Dsa' }));
    expect(within(dsa).getByText('ES 242(N)')).toBeInTheDocument();
    expect(within(dsa).getByText(/allocated once/)).toBeInTheDocument();
  });

  it('keeps failed/unknown attempts visible as not counted with reasons', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    const excluded = await screen.findByRole('region', { name: 'Attempts not counted' });
    expect(within(excluded).getByText('ZZ 103')).toBeInTheDocument();
    expect(within(excluded).getByText(/Not completed/)).toBeInTheDocument();
    expect(within(excluded).getByText('CS 203')).toBeInTheDocument();
    expect(within(excluded).getByText(/Learning designation unknown/)).toBeInTheDocument();
  });

  it('surfaces unresolved CS 203/CS 202 equivalence above the requirement list', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    const decisions = screen.getByRole('region', { name: 'Unresolved decisions and issues' });
    expect(within(decisions).getByText('CS 203 does not establish CS 202 completion.')).toBeInTheDocument();
    const order = decisions.compareDocumentPosition(screen.getByRole('list', { name: 'Requirements' }));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('switches between actual, completed+current and projected views explicitly', async () => {
    const { fetchImpl, calls } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    const actual = screen.getByRole('radio', { name: 'Actual completed' });
    expect(actual).toBeChecked();
    const core = () => (screen.getByRole('list', { name: 'Requirements' }).querySelector('[data-requirement="cse-core"]') as HTMLElement);
    expect(within(core()).getAllByText('Pending').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('radio', { name: 'Completed + current enrolment' }));
    expect(within(core()).getAllByText('Conditional').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('radio', { name: 'Projected plan' }));
    const projectedCall = calls.find((c) => c.path === '/analysis' && (c.body as { plan_id?: string }).plan_id === 'plan-1');
    expect(projectedCall?.body).toMatchObject({ record_revision: 3, plan_id: 'plan-1', plan_revision: 2 });
  });

  it('does not add parent and sub-basket totals into a new degree total', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    const overview = await screen.findByRole('region', { name: 'Overview' });
    expect(within(overview).getByText(/Degree-allocated credits/)).toBeInTheDocument();
    expect(within(overview).getByText(/Unavailable/)).toBeInTheDocument();
    // 26 (parent) + 8 + 8 + 10 (children) = 52 or 4 + 26 = 30 must not appear as a computed total.
    expect(within(overview).queryByText(/^(52|30|56)$/)).not.toBeInTheDocument();
    expect(within(overview).getByText('104')).toBeInTheDocument();
  });

  it('asks a signed-in student without history to import, while still showing public rules', async () => {
    const { fetchImpl, calls } = fakeApi({ ...personalRoutes, 'GET /record': () => ({ data: { ...record, attempts: [], revision: 0 } }) });
    renderApp(<RequirementsPage />, { fetchImpl });
    expect(await screen.findByRole('link', { name: 'Add my record' })).toHaveAttribute('href', '/record/import');
    expect(screen.getByRole('list', { name: 'Requirements' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/analysis')).toBe(false);
  });
});
