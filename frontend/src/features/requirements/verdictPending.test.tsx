import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RequirementResult } from '../../api/types';
import { analysis, catalogue, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { RequirementsPage } from './RequirementsPage';

/**
 * CR-69 (CP-20, D-16): no "complete" verdict while a requirement is still pending, whatever the credits say. The comprehensive viva asks for no
 * credits (a pass in every active semester), so "0 credits remaining" with a pending viva must not read as "complete every requirement".
 */
const done = (id: string): RequirementResult => ({ ...analysis.audit.actual[0]!, id, status: 'satisfied', required_credits: '10', counted_credits: '10', remaining_credits: '0', children: [] });
const viva = (missing: string[]): RequirementResult => ({
  ...analysis.audit.actual[0]!,
  id: 'viva',
  status: missing.length > 0 ? 'pending' : 'satisfied',
  required_credits: '0',
  counted_credits: '0',
  remaining_credits: '0',
  children: [],
  missing_terms: missing,
});

/** Every credit-bearing requirement is met in the current and planned views; only the viva differs. */
function analysisWith(missing: string[]) {
  const tree = [done('hss'), done('cse-core'), done('cse-electives'), viva(missing)];
  const zero = { total_credits: '170', counted_credits: '170', remaining_credits: '0' };
  return {
    ...analysis,
    audit: { ...analysis.audit, degree: { actual: analysis.audit.degree!.actual, current: zero, projected: zero }, current: tree, projected: tree },
  };
}

function routes(missing: string[]) {
  return {
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: catalogue, issues: [] }),
    'GET /record': () => ({ data: record }),
    'GET /plans': () => ({ data: [plan] }),
    'POST /analysis': () => ({ data: analysisWith(missing), issues: [] }),
  };
}

async function verdictIn(view: string, missing: string[]) {
  const { fetchImpl } = fakeApi(routes(missing));
  const { container } = renderApp(<RequirementsPage />, { fetchImpl });
  await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
  await userEvent.click(screen.getByRole('radio', { name: view }));
  return container.querySelector('.build-status') as HTMLElement;
}

describe('the requirements verdict while the viva is pending', () => {
  it('"Completed + current courses" does not say every requirement is complete', async () => {
    const verdict = await verdictIn('Completed + current courses', ['2025-26-II']);
    expect(verdict).not.toHaveTextContent(/complete every requirement/);
    expect(verdict).toHaveTextContent(/Not yet eligible to graduate/);
    expect(verdict).toHaveTextContent(/viva/i);
    expect(verdict).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText(/No viva pass recorded yet for: 2025–26 Semester II\./)).toBeInTheDocument();
  });

  it('"With my plan" does not say the plan covers every requirement', async () => {
    const verdict = await verdictIn('With my plan', ['2025-26-II']);
    expect(verdict).not.toHaveTextContent(/covers every requirement/);
    expect(verdict).toHaveTextContent(/does not cover every requirement yet/);
    expect(verdict).toHaveAttribute('data-tone', 'warning');
  });

  it('"Completed + current courses" says every requirement is complete when nothing is pending (negative)', async () => {
    const verdict = await verdictIn('Completed + current courses', []);
    expect(verdict).toHaveTextContent('✓ Your current courses complete every requirement');
    expect(verdict).toHaveAttribute('data-tone', 'success');
  });

  it('"With my plan" says the plan covers every requirement when nothing is pending (negative)', async () => {
    const verdict = await verdictIn('With my plan', []);
    expect(verdict).toHaveTextContent('Your plan covers every requirement');
  });
});
