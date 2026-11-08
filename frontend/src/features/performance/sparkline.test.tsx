import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../api/types';
import { analysis, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { PerformancePage } from './PerformancePage';
import { SpiSparkline } from './SpiSparkline';

const term = (term_id: string, display_value: string | null) => ({ term_id, display_value });

describe('SpiSparkline', () => {
  it('draws a point only for a term that has a value, and joins just those points', () => {
    const { container } = render(<SpiSparkline terms={[term('2024-25-I', '9.13'), term('2024-25-II', null), term('2025-26-I', '8.77')]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    const line = container.querySelector('polyline')!;
    expect(line.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(2);
  });

  it('puts a higher SPI higher on the drawing than a lower one', () => {
    const { container } = render(<SpiSparkline terms={[term('2024-25-I', '9.00'), term('2024-25-II', '7.00'), term('2025-26-I', '8.00')]} />);
    const cy = [...container.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')));
    expect(cy[0]).toBeLessThan(cy[2]!); // 9.00 above 8.00 (smaller y is higher)
    expect(cy[2]).toBeLessThan(cy[1]!); // 8.00 above 7.00
  });

  it('names the first and last values in its accessible label and in the words under it', () => {
    render(<SpiSparkline terms={[term('2024-25-I', '9.13'), term('2024-25-II', '9.60'), term('2025-26-I', '8.77')]} />);
    expect(screen.getByRole('img', { name: 'SPI went from 9.13 in 2024–25 Semester I to 8.77 in 2025–26 Semester I, over 3 semesters' })).toBeInTheDocument();
    expect(screen.getByText('2024–25 Semester I · 9.13')).toBeInTheDocument();
    expect(screen.getByText('2025–26 Semester I · 8.77')).toBeInTheDocument();
    expect(screen.queryByText(/9\.60/)).not.toBeInTheDocument(); // no numbers are invented or printed along an axis
  });

  it('draws a single point without a line', () => {
    const { container } = render(<SpiSparkline terms={[term('2024-25-I', '9.13'), term('2024-25-II', null)]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelector('polyline')).toBeNull();
    expect(screen.getByRole('img', { name: 'SPI was 9.13 in 2024–25 Semester I' })).toBeInTheDocument();
  });

  it('draws nothing when no term has a value', () => {
    const { container } = render(<SpiSparkline terms={[term('2024-25-I', null)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws a flat line when every SPI is the same', () => {
    const { container } = render(<SpiSparkline terms={[term('a', '10.00'), term('b', '10.00')].map((t, i) => ({ ...t, term_id: ['2024-25-I', '2024-25-II'][i]! }))} />);
    const cy = new Set([...container.querySelectorAll('circle')].map((c) => c.getAttribute('cy')));
    expect(cy.size).toBe(1);
  });
});

describe('Performance page sparkline', () => {
  const setup = (result: AnalysisResult = analysis) => {
    const api = fakeApi({ 'GET /record': () => ({ data: record }), 'GET /plans': () => ({ data: [] }), 'POST /analysis': () => ({ data: result }) });
    renderApp(<PerformancePage />, { fetchImpl: api.fetchImpl });
  };

  it('shows the semesters that have an SPI and leaves out the one without graded credits', async () => {
    setup();
    const region = await screen.findByRole('region', { name: 'Per-term SPI' }, { timeout: 5000 });
    // The fixture has an SPI for 2024–25 Semester I only: one point, named by its value from the server.
    expect(within(region).getByRole('img', { name: 'SPI was 10.00 in 2024–25 Semester I' })).toBeInTheDocument();
  });

  it('lists two values when two semesters have an SPI', async () => {
    const second = { ...analysis.performance.terms[0]!, term_id: '2025-26-II', display_value: '9.50' };
    setup({ ...analysis, performance: { ...analysis.performance, terms: [...analysis.performance.terms, second] } });
    const region = await screen.findByRole('region', { name: 'Per-term SPI' }, { timeout: 5000 });
    expect(within(region).getByRole('img', { name: /^SPI went from 10\.00 in 2024–25 Semester I to 9\.50 in 2025–26 Semester II/ })).toBeInTheDocument();
  });

  it('shows the CPI as the big readout with the points and graded credits beside it', async () => {
    setup();
    const cpi = await screen.findByRole('region', { name: 'Cumulative CPI' }, { timeout: 5000 });
    expect(cpi.querySelector('.perf-cpi dd')).toHaveTextContent('9.23');
    expect(within(cpi).getByText('849')).toBeInTheDocument();
    expect(within(cpi).getByText('92')).toBeInTheDocument();
  });
});
