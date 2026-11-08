import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { analysis, catalogue, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { RequirementsPage } from './RequirementsPage';

const DEVELOPER_TEXT = /\bD-\d\d\b|team decision|[A-Z]{3,}_[A-Z_]{3,}|Rule set|review status|cse-2024|BTECH_CSE|Why\?|Server revision|Record revision/;
const publicRoutes = {
  'GET /curricula/cse-2024': () => ({ data: curriculum, issues: [issue('SOURCE_MISSING', 'unknown', [], 'Only a draft is available.')] }),
  'GET /catalogue': () => ({ data: catalogue, issues: [] }),
};

describe('RequirementsPage — public mode (CP-01)', () => {
  it('shows every requirement group before any history or sign-in, each as a button that opens it', async () => {
    const { fetchImpl, calls } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('heading', { level: 1, name: 'Graduation requirements' });
    const list = screen.getByRole('list', { name: 'Requirements' });
    for (const label of ['HSS (GE included)', 'Science basket', 'Bs elective', 'Cse core', 'Cse electives']) {
      expect(within(list).getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}`) })).toBeInTheDocument();
    }
    expect(calls.some((c) => c.path === '/record' || c.path === '/analysis')).toBe(false);
  });

  it('opens and closes a group: aria-expanded toggles and the courses appear', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const list = await screen.findByRole('list', { name: 'Requirements' });
    const core = within(list).getByRole('button', { name: /^Cse core/ });
    expect(core).toHaveAttribute('aria-expanded', 'false');
    expect(within(list).queryByText('CS 202')).not.toBeInTheDocument();
    await userEvent.click(core);
    expect(core).toHaveAttribute('aria-expanded', 'true');
    expect(within(list).getByText('CS 202')).toBeInTheDocument();
    expect(within(list).getByText('ES 242')).toBeInTheDocument();
    await userEvent.click(core);
    expect(core).toHaveAttribute('aria-expanded', 'false');
    expect(within(list).queryByText('CS 202')).not.toBeInTheDocument();
  });

  it('lists the courses of a basket from the rules and the catalogue, with titles', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const list = await screen.findByRole('list', { name: 'Requirements' });
    await userEvent.click(within(list).getByRole('button', { name: /^Cse electives/ }));
    await userEvent.click(within(list).getByRole('button', { name: /^Theory/ }));
    const courses = within(list).getByRole('list', { name: 'Courses for Theory' });
    expect(within(courses).getByText('ZZ 301')).toBeInTheDocument();
    expect(within(courses).getByText('Synthetic theory course')).toBeInTheDocument();
    expect(within(courses).getByText('ZZ 614')).toBeInTheDocument(); // named by the rules, not in the catalogue: code only
  });

  it('shows no draft banner, rule version, source or decision text, and no issue panel', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    const list = await screen.findByRole('list', { name: 'Requirements' });
    for (const button of within(list).getAllByRole('button')) await userEvent.click(button);
    expect(container.textContent).not.toMatch(DEVELOPER_TEXT);
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total in these rules/)).not.toBeInTheDocument();
    expect(screen.queryByText('Only a draft is available.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unresolved decisions and issues' })).not.toBeInTheDocument();
  });

  it('states the degree total in plain words', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    expect(await screen.findByText(/170 credits to graduate/)).toBeInTheDocument();
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
  it('shows credits counted against the degree total and the credits remaining, as reported by the server', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    const overview = await screen.findByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Credits counted').parentElement).toHaveTextContent('104 of 170');
    expect(within(overview).getByText('Credits remaining').parentElement).toHaveTextContent('66');
    // Parent and sub-basket totals are never added into a new degree total.
    expect(within(overview).queryByText(/^(52|30|56)$/)).not.toBeInTheDocument();
  });

  it('says clearly that the student is not yet eligible to graduate, and how many credits to go', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    const overview = await screen.findByRole('region', { name: 'Overview' });
    expect(within(overview).getByRole('status')).toHaveTextContent('Not yet eligible to graduate — 66 credits to go');
  });

  it('says graduation requirements are complete only when the server says the audit is complete', async () => {
    const complete = { ...analysis, audit: { ...analysis.audit, complete: true, degree: { ...analysis.audit.degree!, actual: { total_credits: '170', counted_credits: '170', remaining_credits: '0' } } } };
    const { fetchImpl } = fakeApi({ ...personalRoutes, 'POST /analysis': () => ({ data: complete }) });
    renderApp(<RequirementsPage />, { fetchImpl });
    const overview = await screen.findByRole('region', { name: 'Overview' });
    expect(within(overview).getByRole('status')).toHaveTextContent('Graduation requirements complete');
    expect(within(overview).queryByText(/Not yet eligible/)).not.toBeInTheDocument();
  });

  it('never calls an audit complete just because zero credits remain: the server decides', async () => {
    const zero = { ...analysis, audit: { ...analysis.audit, complete: false, degree: { ...analysis.audit.degree!, actual: { total_credits: '170', counted_credits: '170', remaining_credits: '0' } } } };
    const { fetchImpl } = fakeApi({ ...personalRoutes, 'POST /analysis': () => ({ data: zero }) });
    renderApp(<RequirementsPage />, { fetchImpl });
    const overview = await screen.findByRole('region', { name: 'Overview' });
    expect(within(overview).getByRole('status')).not.toHaveTextContent('Graduation requirements complete');
  });

  it('switches between completed, current and plan views, with plain labels and a plan verdict', async () => {
    const { fetchImpl, calls } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    expect(screen.getByRole('radio', { name: 'Completed' })).toBeChecked();
    const core = () => screen.getByRole('list', { name: 'Requirements' }).querySelector('[data-requirement="cse-core"]') as HTMLElement;
    expect(within(core()).getByText('To do')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Completed + current courses' }));
    expect(within(core()).getByText('Planned')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'With my plan' }));
    const projectedCall = calls.find((c) => c.path === '/analysis' && (c.body as { plan_id?: string }).plan_id === 'plan-1');
    expect(projectedCall?.body).toMatchObject({ record_revision: 3, plan_id: 'plan-1', plan_revision: 2 });
    expect(await screen.findByText('Your plan leaves 54 credits uncovered')).toBeInTheDocument();
  });

  it('shows what was counted for a course: the course taken and its grade', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    const list = screen.getByRole('list', { name: 'Requirements' });
    await userEvent.click(await within(list).findByRole('button', { name: /^Cse core/ }));
    const row = within(list).getByText('ES 242').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('Done');
    expect(row).toHaveTextContent('ES 242(N)');
    expect(row).toHaveTextContent('grade A');
    expect(within(list).getByText('CS 202').closest('li')).toHaveTextContent('To do');
  });

  it('shows each group with credits counted of credits required, never above what it asks for', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    const list = screen.getByRole('list', { name: 'Requirements' });
    expect(within(list).getByRole('button', { name: /^Cse electives/ })).toHaveTextContent('26 of 26 credits');
    expect(within(list).getByRole('button', { name: /^Cse core/ })).toHaveTextContent('4 of 36 credits');
  });

  it('lists only things a student can act on: no codes, no notes, no draft or source wording', async () => {
    const withNote = { ...analysis, audit: { ...analysis.audit, issues: [...analysis.audit.issues, { ...analysis.audit.issues[0]!, code: 'STANDING_ASSUMED', severity: 'info' as const, message: 'Assuming regular standing (28-credit cap) until you set it (D-31).' }] } };
    const { fetchImpl } = fakeApi({ ...personalRoutes, 'POST /analysis': () => ({ data: withNote, issues: withNote.audit.issues }) });
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    const things = await screen.findByRole('region', { name: 'Things to check' });
    expect(things).toHaveTextContent('CS 203 does not establish CS 202 completion.');
    expect(container.textContent).not.toMatch(/Assuming regular standing/);
    expect(container.textContent).not.toMatch(DEVELOPER_TEXT);
  });

  it('shows no developer text anywhere on the personal page, even with every group open', async () => {
    const { fetchImpl } = fakeApi(personalRoutes);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    const list = screen.getByRole('list', { name: 'Requirements' });
    for (const button of within(list).getAllByRole('button', { name: /credits/ })) await userEvent.click(button);
    expect(container.textContent).not.toMatch(DEVELOPER_TEXT);
    expect(screen.queryByText(/Degree-allocated|Unavailable|Overall verdict|as reported by the server/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Attempts not counted' })).not.toBeInTheDocument();
  });

  it('asks a signed-in student without history to import, while still showing public rules', async () => {
    const { fetchImpl, calls } = fakeApi({ ...personalRoutes, 'GET /record': () => ({ data: { ...record, attempts: [], revision: 0 } }) });
    renderApp(<RequirementsPage />, { fetchImpl });
    expect(await screen.findByRole('link', { name: 'Add my record' })).toHaveAttribute('href', '/record/import');
    expect(screen.getByRole('list', { name: 'Requirements' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/analysis')).toBe(false);
  });
});
