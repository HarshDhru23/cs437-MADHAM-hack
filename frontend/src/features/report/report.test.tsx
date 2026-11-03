import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import auditExample from '../../../../examples/audit.json';
import planValidationExample from '../../../../examples/plan-validation.json';
import type { AnalysisResult, AuditResult, PlanValidation, Scenario } from '../../api/types';
import { analysis, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp, type FakeHandler } from '../../test/harness';
import { ReportPage } from './ReportPage';

const wait = { timeout: 5000 };

function routes(result: AnalysisResult, issues: unknown[] = [], extra: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    'GET /record': () => ({ data: record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /plans/:id': () => ({ data: plan }),
    'POST /analysis': () => ({ data: result, issues }),
    ...extra,
  };
}

/** The shared contract examples: an audit and a plan validation, as the server returns them. */
const exampleResult: AnalysisResult = {
  ...analysis,
  audit: auditExample.data as unknown as AuditResult,
  validation: planValidationExample.data as unknown as PlanValidation,
  rule_version: auditExample.data.rule_version,
  plan_revision: plan.revision,
};

describe('ReportPage (A11, CP-30)', () => {
  it('renders the printable report from the server analysis of the saved plan', async () => {
    const { fetchImpl, calls } = fakeApi(routes(exampleResult, [...auditExample.issues]));
    renderApp(<ReportPage />, { fetchImpl, route: '/report/plan-1', path: '/report/:plan_id' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Printable report' }, wait)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Not an official institute approval.');

    // Rules, review status and sources, including what is missing.
    const rules = screen.getByRole('region', { name: 'Rules and sources' });
    expect(rules).toHaveTextContent('BTECH_CSE-2024');
    expect(rules).toHaveTextContent('Review status');
    expect(rules).toHaveTextContent('draft');
    expect(rules).toHaveTextContent('committed-roadmap');
    expect(rules).toHaveTextContent('Reviewed catalogue and basket memberships');
    expect(screen.getByRole('region', { name: 'Actual, current and projected' })).toHaveTextContent('A projection is not completed history');

    // Requirement status per view, straight from examples/audit.json: CSE core needs review, 0 of 36, remaining not reported.
    const status = screen.getByRole('region', { name: 'Requirement status' });
    const actual = await within(status).findByRole('table', { name: 'Actual completed history' }, wait);
    const core = within(actual).getByRole('row', { name: /cse core/i });
    expect(core).toHaveTextContent('Needs review');
    expect(within(core).getAllByRole('cell').map((c) => c.textContent)).toEqual(['?Needs review', '0', '36', 'Unknown', 'None']);
    expect(within(status).getByRole('table', { name: 'Completed + confirmed current enrolment' })).toBeInTheDocument();
    expect(within(status).getByRole('table', { name: 'Projected with this plan' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/analysis')?.body).toEqual({ record_revision: 3, plan_id: 'plan-1', plan_revision: 2, award_ids: [] });

    // Semesters with server workload, placeholders as unresolved.
    const semesters = screen.getByRole('region', { name: 'Planned semesters' });
    const first = within(semesters).getByRole('table', { name: /2026–27 Semester I\b/ });
    expect(first).toHaveTextContent('ZZ 330');
    expect(first).toHaveTextContent('selected 8 credits; placeholders 4 credits (server)');
    expect(within(semesters).getByRole('table', { name: /2026–27 Semester II/ })).toHaveTextContent('Placeholder: HSS elective');
    expect(within(semesters).getByRole('table', { name: /2027–28 Semester I\b/ })).toHaveTextContent('Nothing planned.');

    expect(screen.getByRole('region', { name: 'Scenario assumptions' })).toHaveTextContent('None. This report shows the saved plan without any what-if scenario.');
    const issues = screen.getByRole('region', { name: 'Unresolved issues' });
    expect(issues).toHaveTextContent('EQUIVALENCE_UNCONFIRMED');
    expect(issues).toHaveTextContent('Synthetic required lectures overlap.');
  });

  it('lists counted courses from the server ledger without adding anything up', async () => {
    const { fetchImpl } = fakeApi(routes(analysis));
    renderApp(<ReportPage />, { fetchImpl, route: '/report/plan-1', path: '/report/:plan_id' });
    const actual = await screen.findByRole('table', { name: 'Actual completed history' }, wait);
    const dsa = within(actual).getByRole('row', { name: /^Dsa\b/ });
    expect(dsa).toHaveTextContent('Satisfied');
    expect(dsa).toHaveTextContent('ES 242(N) · 4 credits · base');
    // The parent shows the server's own values, not anything the browser added up from its children.
    const core = within(actual).getByRole('row', { name: /^Cse core/ });
    expect(within(core).getAllByRole('cell').map((c) => c.textContent)).toEqual(['○Pending', '4', '36', '32', 'None']);
    expect(screen.getByRole('region', { name: 'Requirement status' })).toHaveTextContent('ZZ 103 — Not completed');
  });

  it('lists the chosen scenario\'s assumptions and prints on request', async () => {
    const scenario: Scenario = {
      id: 'scen-1',
      revision: 1,
      plan_id: 'plan-1',
      label: 'Six-month internship',
      baseline_record_revision: 3,
      baseline_plan_revision: 2,
      rule_version: 'cse-2024-draft-v1',
      changes: [
        { op: 'postpone', item_id: 'c-os', term_id: '2027-28-I' },
        { op: 'fail', item_id: 'c-net' },
      ],
      internship: { duration_choice: 'six_months', start_date: '2027-01-01', end_date_exclusive: '2027-07-01', placement_mode: 'onsite_full_time' },
      award_ids: [],
    };
    const { fetchImpl, calls } = fakeApi(routes(analysis, [], { 'GET /scenarios/:id': () => ({ data: scenario }) }));
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(<ReportPage />, { fetchImpl, route: '/report/plan-1?scenario=scen-1', path: '/report/:plan_id' });
    const section = await screen.findByRole('region', { name: 'Scenario assumptions' }, wait);
    await waitFor(() => expect(section).toHaveTextContent('Six-month internship'));
    expect(calls.some((c) => c.path === '/scenarios/scen-1')).toBe(true);
    expect(section).toHaveTextContent('Postpone: course ZZ 330, term 2027–28 Semester I');
    expect(section).toHaveTextContent('Fail: course ZZ 331 (hypothetical; never applied to your record)');
    expect(section).toHaveTextContent('Duration choice: Six months');
    expect(section).toHaveTextContent('Start date: 2027-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('a plan that is missing or belongs to someone else shows not found, not data', async () => {
    const { fetchImpl } = fakeApi(routes(analysis, [], { 'GET /plans/:id': () => ({ status: 404, issues: [] }) }));
    renderApp(<ReportPage />, { fetchImpl, route: '/report/other-plan', path: '/report/:plan_id' });
    expect(await screen.findByText('Plan not found', {}, wait)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
