import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { PlanValidation } from '../../api/types';
import { issue, renderApp } from '../../test/harness';
import { PlanPage } from './PlanPage';
import { planServer } from './planServerFake';

// Issue #157 (CP-50): a folded semester must not hide its own problems, and a problem that points into it opens it.

const II = '2026–27 Semester II';
const LIMIT = 'This semester is over the 28-credit limit.'; // how the page words the server's LOAD_LIMIT
const overLimit = issue('LOAD_LIMIT', 'error', ['2026-27-II'], 'Target workload exceeds the 28-credit limit.') as PlanValidation['issues'][number];

const render = () =>
  renderApp(<PlanPage />, { fetchImpl: planServer({ issues: [overLimit] }).fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });

async function foldAllButCurrent() {
  await screen.findByRole('region', { name: II });
  await screen.findByRole('button', { name: `Show affected items: ${LIMIT}` });
  await userEvent.click(screen.getByRole('button', { name: 'Show only the current semester' }));
  const sem = screen.getByRole('region', { name: II });
  expect(within(sem).queryByRole('table')).not.toBeInTheDocument();
  return sem;
}

describe('A folded semester and its problems (issue #157)', () => {
  it('says in the folded semester that it has a problem, in words a screen reader reads', async () => {
    render();
    const sem = await foldAllButCurrent();
    expect(within(sem).getByText('1 problem')).toBeInTheDocument();
    expect(within(sem).getByText('1 problem')).not.toHaveAttribute('aria-hidden');
  });

  it('opens the folded semester when the student picks its problem in Validation, and highlights it', async () => {
    render();
    const sem = await foldAllButCurrent();
    await userEvent.click(screen.getByRole('button', { name: `Show affected items: ${LIMIT}` }));
    expect(within(sem).getByRole('table', { name: `Planned items for ${II}` })).toBeInTheDocument();
    expect(within(sem).getByRole('button', { name: `Hide ${II}` })).toHaveAttribute('aria-expanded', 'true');
    expect(within(sem).getByText(LIMIT)).toBeInTheDocument();
  });

  it('opens the semester of a course whose problem is picked', async () => {
    const onCourse = issue('PREREQ_UNKNOWN', 'error', ['c-net'], 'ZZ 331 problem') as PlanValidation['issues'][number];
    renderApp(<PlanPage />, { fetchImpl: planServer({ issues: [onCourse] }).fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });
    await screen.findByRole('region', { name: II });
    const show = await screen.findByRole('button', { name: /^Show affected items: .*ZZ 331 problem/ });
    await userEvent.click(screen.getByRole('button', { name: 'Show only the current semester' }));
    await userEvent.click(show);
    const sem = screen.getByRole('region', { name: II });
    const row = within(sem).getByText('ZZ 331').closest('tr') as HTMLElement;
    expect(row).toHaveAttribute('data-highlight', 'true');
  });

  it('says nothing extra on an open semester or a folded one with no problem', async () => {
    render();
    await foldAllButCurrent();
    expect(within(screen.getByRole('region', { name: '2027–28 Semester I' })).queryByText(/problem/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show every semester' }));
    expect(within(screen.getByRole('region', { name: II })).queryByText('1 problem')).not.toBeInTheDocument();
  });
});
