import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../api/types';
import { analysis, record } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { PerformancePage } from './PerformancePage';

function setup(result: AnalysisResult = analysis, issues: unknown[] = []) {
  const api = fakeApi({ 'GET /record': () => ({ data: record }), 'GET /plans': () => ({ data: [] }), 'POST /analysis': () => ({ data: result, issues }) });
  renderApp(<PerformancePage />, { fetchImpl: api.fetchImpl });
  return api;
}

describe('PerformancePage (A07, CP-15/16)', () => {
  it('shows the CPI with its points and graded-credit denominator', async () => {
    const { calls } = setup();
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText('CPI').parentElement).toHaveTextContent('9.23');
    expect(within(cpi).getByText('849')).toBeInTheDocument();
    expect(within(cpi).getByText('92')).toBeInTheDocument();
    expect(within(cpi).queryByText('105')).not.toBeInTheDocument();
    expect(calls.find((c) => c.path === '/analysis')?.body).toMatchObject({ record_revision: 3 });
  });

  it('shows no developer detail: no server wording, policy ids, revisions or source-reported rows', async () => {
    setup();
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(cpi).not.toHaveTextContent(/server|policy|revision|Source-reported|rounded/i);
    expect(screen.queryByText(/Policy (in)?complete/)).not.toBeInTheDocument();
  });

  it('shows a dash with a plain reason when there is no display value, never 0', async () => {
    const unrounded: AnalysisResult = {
      ...analysis,
      performance: { ...analysis.performance, cumulative: { ...analysis.performance.cumulative, display_value: null, source_reported_value: null } },
    };
    setup(unrounded, [issue('ROUNDING_POLICY_UNKNOWN', 'unknown', [], 'No official display rounding policy supplied; display value unavailable.')]);
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText('CPI').parentElement).toHaveTextContent('—');
    expect(within(cpi).getByText('CPI').parentElement).not.toHaveTextContent(/\b0\b/);
    expect(within(cpi).queryByText(/9.228260869565217391304347826086956521739/)).not.toBeInTheDocument();
    // The student-actionable note is still shown, without its code.
    const notes = screen.getByRole('region', { name: 'Performance notes' });
    expect(notes).toHaveTextContent('No official display rounding policy supplied');
    expect(notes).not.toHaveTextContent('ROUNDING_POLICY_UNKNOWN');
  });

  it('shows missing points or denominator as a dash, never Unknown or 0', async () => {
    const missing: AnalysisResult = {
      ...analysis,
      performance: {
        ...analysis.performance,
        cumulative: { ...analysis.performance.cumulative, grade_points: null, performance_credits: null, display_value: null, unrounded_value: null },
        terms: analysis.performance.terms.map((t) => ({ ...t, grade_points: null, performance_credits: null })),
      },
    };
    setup(missing);
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText('Grade points').parentElement).toHaveTextContent('—');
    expect(within(cpi).getByText('Graded credits').parentElement).toHaveTextContent('—');
    expect(within(cpi).queryByText('Unknown')).not.toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Term SPI' });
    expect(within(table).queryByText('Unknown')).not.toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('lists per-term SPI; a zero denominator shows a dash with a reason', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Term SPI' });
    const t1 = within(table).getByRole('row', { name: /2024–25 Semester I/ });
    expect(t1).toHaveTextContent('10.00');
    const t3 = within(table).getByRole('row', { name: /2025–26 Semester I/ });
    expect(t3).toHaveTextContent('—');
    expect(t3).toHaveTextContent(/No graded credits/);
  });

  it('expands a term to show included and excluded attempts; P is excluded from performance', async () => {
    setup();
    await screen.findByRole('table', { name: 'Term SPI' });
    await userEvent.click(screen.getByRole('button', { name: 'Attempts for 2025–26 Semester I' }));
    const detail = screen.getByRole('region', { name: 'Attempts in 2025–26 Semester I' });
    expect(within(detail).getByText('ZZ 299')).toBeInTheDocument();
    expect(within(detail).getByText(/Performance excluded grade/)).toBeInTheDocument();
  });

  it('labels hypothetical values unmistakably as a scenario', async () => {
    const hypothetical: AnalysisResult = { ...analysis, performance: { ...analysis.performance, cumulative: { ...analysis.performance.cumulative, hypothetical: true } } };
    setup(hypothetical);
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText(/Scenario — hypothetical grades/)).toBeInTheDocument();
  });
});
