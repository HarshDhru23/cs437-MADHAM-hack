/**
 * CP-47: a student with more credits than the degree asks for sees it, for example 172 of 170, on the requirements screen and on the plan screen. The
 * numbers are the server's (`degree_surplus.earned_credits`); the count of what each requirement asks for stays at 170.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult, PlanCheck } from '../../api/types';
import { analysis, catalogue, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { PlanProgress } from '../plan/PlanProgress';
import { ReportPage } from '../report/ReportPage';
import { RequirementsPage } from './RequirementsPage';

const over: AnalysisResult = {
  ...analysis,
  audit: {
    ...analysis.audit,
    degree: { actual: { total_credits: '170', counted_credits: '170', remaining_credits: '0' }, current: { total_credits: '170', counted_credits: '170', remaining_credits: '0' }, projected: { total_credits: '170', counted_credits: '170', remaining_credits: '0' } },
    degree_surplus: { actual: { surplus_credits: '2', earned_credits: '172' }, current: { surplus_credits: '2', earned_credits: '172' }, projected: { surplus_credits: '2', earned_credits: '172' } },
  },
};
const exactly = (data: AnalysisResult): AnalysisResult => ({
  ...data,
  audit: { ...data.audit, degree: { actual: { total_credits: '170', counted_credits: '170', remaining_credits: '0' }, current: { total_credits: '170', counted_credits: '170', remaining_credits: '0' }, projected: { total_credits: '170', counted_credits: '170', remaining_credits: '0' } },
    degree_surplus: { actual: { surplus_credits: '0', earned_credits: '170' }, current: { surplus_credits: '0', earned_credits: '170' }, projected: { surplus_credits: '0', earned_credits: '170' } } },
});

const routes = (data: AnalysisResult) => ({
  'GET /curricula/cse-2024': () => ({ data: curriculum, issues: [issue('SOURCE_MISSING', 'unknown', [], 'Only a draft is available.')] }),
  'GET /catalogue': () => ({ data: catalogue, issues: [] }),
  'GET /record': () => ({ data: record }),
  'GET /plans': () => ({ data: [plan] }),
  'POST /analysis': () => ({ data, issues: data.audit.issues }),
});

async function overview(data: AnalysisResult) {
  renderApp(<RequirementsPage />, { fetchImpl: fakeApi(routes(data)).fetchImpl });
  return screen.findByRole('region', { name: 'Overview' });
}

describe('Credits above the degree total on the requirements screen (CP-47)', () => {
  it('shows 172 of 170 in the overview, the ring and says how many are beyond what the degree needs', async () => {
    const region = await overview(over);
    expect(within(region).getByText('Credits counted').parentElement).toHaveTextContent('172 of 170');
    expect(within(region).getByText('Credits remaining').parentElement).toHaveTextContent('0');
    expect(region).toHaveTextContent(/2 credits more than the 170 the degree asks for/);
    expect(within(region).getByRole('img', { name: /172 of 170 degree credits counted/ })).toBeInTheDocument();
  });

  it('shows no such note and the plain count when the credits are exactly what the degree asks for', async () => {
    const region = await overview(exactly(over));
    expect(within(region).getByText('Credits counted').parentElement).toHaveTextContent('170 of 170');
    expect(region).not.toHaveTextContent(/more than the 170/);
  });

  it('shows the plain count when the server sends no surplus at all', async () => {
    const plain: AnalysisResult = { ...over, audit: { ...over.audit, degree_surplus: undefined } };
    const region = await overview(plain);
    expect(within(region).getByText('Credits counted').parentElement).toHaveTextContent('170 of 170');
    expect(region).not.toHaveTextContent(/more than the 170/);
  });

  it('shows it in the "With my plan" view too, from the plan the student is looking at', async () => {
    const withPlan: AnalysisResult = {
      ...over,
      plan_holds: { degree: { total_credits: '170', counted_credits: '170', held_credits: '0', remaining_credits: '0' }, degree_surplus: { surplus_credits: '24', earned_credits: '194' }, requirements: {} },
    };
    const api = fakeApi(routes(withPlan));
    renderApp(<RequirementsPage />, { fetchImpl: api.fetchImpl });
    await screen.findByRole('region', { name: 'Overview' });
    await userEvent.click(screen.getByRole('radio', { name: 'With my plan' }));
    const region = screen.getByRole('region', { name: 'Overview' });
    expect(within(region).getByText('Credits counted').parentElement).toHaveTextContent('194 of 170');
    expect(region).toHaveTextContent(/24 credits more than the 170 the degree asks for/);
  });
});

const check = (change: Partial<PlanCheck> = {}): PlanCheck =>
  ({
    status: { valid: true, problems: 0, uncovered_credits: '0' },
    validation: { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null },
    degree: { total_credits: '170', counted_credits: '170', remaining_credits: '0' },
    degree_surplus: { surplus_credits: '2', earned_credits: '172' },
    placeholder_credits: '0',
    uncovered_credits: '0',
    requirements: [],
    online: { planned_credits: '0', counted_credits: '0' },
    load: {},
    ...change,
  }) as PlanCheck;

describe('Credits above the degree total on the plan screen (CP-47)', () => {
  it('says 172 of 170 degree credits are covered and how many are beyond what the degree needs', () => {
    render(<PlanProgress check={check()} pending={false} />);
    expect(screen.getByText('172 of 170 degree credits covered by your plan')).toBeInTheDocument();
    expect(screen.getByText(/2 credits more than the degree asks for/)).toBeInTheDocument();
  });

  it('keeps the plain wording when nothing is beyond what the degree asks for', () => {
    render(<PlanProgress check={check({ degree_surplus: { surplus_credits: '0', earned_credits: '170' } })} pending={false} />);
    expect(screen.getByText('170 of 170 degree credits covered by your plan')).toBeInTheDocument();
    expect(screen.queryByText(/more than the degree asks for/)).not.toBeInTheDocument();
  });

  it('keeps the plain wording for a server that sends no surplus', () => {
    render(<PlanProgress check={check({ degree_surplus: undefined })} pending={false} />);
    expect(screen.getByText('170 of 170 degree credits covered by your plan')).toBeInTheDocument();
  });
});

describe('Credits above the degree total on the printable report (CP-47)', () => {
  it('prints 172 of 170 where the report states the credits counted', async () => {
    const { fetchImpl } = fakeApi({
      'GET /record': () => ({ data: record }),
      'GET /curricula/cse-2024': () => ({ data: curriculum }),
      'GET /plans/:id': () => ({ data: plan }),
      'POST /analysis': () => ({ data: { ...over, plan_revision: plan.revision }, issues: [] }),
    });
    renderApp(<ReportPage />, { fetchImpl, route: '/report/plan-1', path: '/report/:plan_id' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Printable report' }, { timeout: 5000 })).toBeInTheDocument();
    expect((await screen.findByText('Credits counted', undefined, { timeout: 5000 })).parentElement).toHaveTextContent('172 of 170');
  });
});
