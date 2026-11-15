import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScenarioComparison } from '../../api/types';
import { HeadlineFigures } from './HeadlineFigures';

// Review follow-up to #156 (CP-50): the server's finishing term is null when the plan does not cover the degree. "You finish" then says so
// in words instead of a bare dash, and only when the server did evaluate the scenario (nothing is computed here).

const evaluation = (completion: string | null) => ({ completion_term: completion, validation: { workload: {}, completion_term: null }, performance: {} });
const comparison = (scenario: string | null | undefined, baseline: string | null) =>
  ({ baseline: evaluation(baseline), scenario: scenario === undefined ? null : evaluation(scenario) }) as unknown as ScenarioComparison;

const finishCard = () => within(screen.getByRole('group', { name: 'What happens in brief' })).getByText('You finish').closest('.scn-figure') as HTMLElement;

describe('"You finish" when the scenario leaves part of the degree uncovered', () => {
  it('says "Not covered yet" in words, and keeps the dash', () => {
    render(<HeadlineFigures comparison={comparison(null, '2027-28-II')} stale={false} />);
    expect(finishCard()).toHaveTextContent('—');
    expect(finishCard()).toHaveTextContent('Not covered yet');
    expect(finishCard()).toHaveTextContent(/part of your degree is still missing/i);
  });

  it('says it when neither the plan nor the scenario covers the degree', () => {
    render(<HeadlineFigures comparison={comparison(null, null)} stale={false} />);
    expect(finishCard()).toHaveTextContent('Not covered yet');
  });

  it('shows the semester, with no "Not covered yet", when the server gives one', () => {
    render(<HeadlineFigures comparison={comparison('2028-29-I', '2027-28-II')} stale={false} />);
    expect(finishCard()).toHaveTextContent('2028–29 Semester I');
    expect(finishCard()).not.toHaveTextContent('Not covered yet');
  });

  it('says nothing when the scenario has not been evaluated at all', () => {
    render(<HeadlineFigures comparison={comparison(undefined, '2027-28-II')} stale={false} />);
    expect(finishCard()).not.toHaveTextContent('Not covered yet');
  });
});
