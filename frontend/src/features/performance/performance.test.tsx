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
  it('shows the server CPI with its points and performance-credit denominator', async () => {
    const { calls } = setup();
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText('CPI (server)').parentElement).toHaveTextContent('9.23');
    expect(within(cpi).getByText('849')).toBeInTheDocument();
    expect(within(cpi).getByText('92')).toBeInTheDocument();
    expect(within(cpi).queryByText('105')).not.toBeInTheDocument();
    expect(within(cpi).getByText(/Source-reported CPI/).parentElement).toHaveTextContent('9.23');
    expect(calls.find((c) => c.path === '/analysis')?.body).toMatchObject({ record_revision: 3 });
  });

  it('shows Unavailable with the reason when the server has no display value, never 0', async () => {
    const unrounded: AnalysisResult = {
      ...analysis,
      performance: { ...analysis.performance, cumulative: { ...analysis.performance.cumulative, display_value: null, source_reported_value: null } },
    };
    setup(unrounded, [issue('ROUNDING_POLICY_UNKNOWN', 'unknown', [], 'No official display rounding policy supplied; display value unavailable.')]);
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText('Unavailable')).toBeInTheDocument();
    expect(within(cpi).getByText(/No official display rounding policy supplied/)).toBeInTheDocument();
    expect(within(cpi).getByText(/9.228260869565217391304347826086956521739/)).toBeInTheDocument();
    expect(within(cpi).queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('shows the CPI, points and credits printed by the imported document beside the server values', async () => {
    // The real API leaves the policy's source value null and returns the transcript's printed controls separately.
    const fromImport: AnalysisResult = {
      ...analysis,
      performance: {
        ...analysis.performance,
        cumulative: { ...analysis.performance.cumulative, display_value: null, source_reported_value: null },
        source_reported_controls: [
          { preview_id: 'p1', record_revision_at_import: 1, controls: { earned_credits: '104', performance_credits: '92', grade_points: '849', cpi: '9.23' }, source_refs: ['pdf-v1'] },
        ],
      },
    };
    setup(fromImport);
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    const reported = within(cpi).getByText('Source-reported CPI').parentElement as HTMLElement;
    expect(reported).toHaveTextContent('9.23');
    expect(reported).toHaveTextContent('As printed in the document imported at record revision 1; not recalculated.');
    expect(within(cpi).getByText('Source-reported points / performance credits').parentElement).toHaveTextContent('849 / 92');
    expect(within(cpi).getByText('CPI (server)').parentElement).toHaveTextContent('Unavailable');
  });

  it('says the source reported no CPI instead of showing a number', async () => {
    const none: AnalysisResult = {
      ...analysis,
      performance: { ...analysis.performance, cumulative: { ...analysis.performance.cumulative, source_reported_value: null }, source_reported_controls: [] },
    };
    setup(none);
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText('Source-reported CPI').parentElement).toHaveTextContent('Not reported by your source');
    expect(within(cpi).queryByText('Source-reported points / performance credits')).not.toBeInTheDocument();
  });

  it('lists per-term SPI; a zero denominator is Unavailable with a reason', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Term SPI' });
    const t1 = within(table).getByRole('row', { name: /2024–25 Semester I/ });
    expect(t1).toHaveTextContent('10.00');
    const t3 = within(table).getByRole('row', { name: /2025–26 Semester I/ });
    expect(t3).toHaveTextContent('Unavailable');
    expect(t3).toHaveTextContent(/No graded performance credits/);
  });

  it('expands a term to show included and excluded attempts; P is excluded from performance', async () => {
    setup();
    await screen.findByRole('table', { name: 'Term SPI' });
    await userEvent.click(screen.getByRole('button', { name: 'Attempts for 2025–26 Semester I' }));
    const detail = screen.getByRole('region', { name: 'Attempts in 2025–26 Semester I' });
    expect(within(detail).getByText('ZZ 299')).toBeInTheDocument();
    expect(within(detail).getByText(/Performance excluded grade/)).toBeInTheDocument();
  });

  it('shows policy completeness as incomplete when the server says so', async () => {
    setup();
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText(/Policy incomplete/)).toBeInTheDocument();
  });

  it('labels hypothetical values unmistakably as a scenario', async () => {
    const hypothetical: AnalysisResult = { ...analysis, performance: { ...analysis.performance, cumulative: { ...analysis.performance.cumulative, hypothetical: true } } };
    setup(hypothetical);
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' });
    expect(within(cpi).getByText(/Scenario — hypothetical grades/)).toBeInTheDocument();
  });
});
