import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/harness';
import { PlanPage } from './PlanPage';
import { planServer } from './planServerFake';

const render = () => renderApp(<PlanPage />, { fetchImpl: planServer().fetchImpl, route: '/plan/plan-1', path: '/plan/:plan_id' });
const II = '2026–27 Semester II';
const waitForFold = async (el: HTMLElement) => {
  await screen.findByText(/credits left for graduation/);
  return el.querySelector('details.pb-needed') as HTMLDetailsElement;
};

describe('The plan page shows less at once (CP-50)', () => {
  it('lets a semester be hidden and shown again, keeping its name and load while hidden', async () => {
    const { container } = render();
    const sem = await screen.findByRole('region', { name: II });
    expect(within(sem).getByRole('table', { name: `Planned items for ${II}` })).toBeInTheDocument();
    const toggle = within(sem).getByRole('button', { name: `Hide ${II}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(within(sem).queryByRole('table')).not.toBeInTheDocument();
    expect(within(sem).queryByRole('button', { name: `Add course to ${II}` })).not.toBeInTheDocument();
    expect(within(sem).getByRole('heading', { name: II })).toBeInTheDocument();
    expect(container.querySelector('.pb-col[data-collapsed="true"] .pb-meter')).not.toBeNull();
    await userEvent.click(within(sem).getByRole('button', { name: `Show ${II}` }));
    expect(within(sem).getByRole('table', { name: `Planned items for ${II}` })).toBeInTheDocument();
    expect(within(sem).getByRole('button', { name: `Hide ${II}` })).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides every semester but the current one with one button, and shows them all again with another', async () => {
    render();
    await screen.findByRole('region', { name: II });
    await userEvent.click(screen.getByRole('button', { name: 'Show only the current semester' }));
    expect(within(screen.getByRole('region', { name: '2026–27 Semester I' })).getByRole('table')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: II })).queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show every semester' }));
    expect(within(screen.getByRole('region', { name: II })).getByRole('table')).toBeInTheDocument();
  });

  it('keeps Move on each course in a quiet control of its own, shown when the row is pointed at or reached by keyboard, with Remove beside it', async () => {
    render();
    const sem = await screen.findByRole('region', { name: II });
    const row = within(sem).getByText('ZZ 331').closest('tr') as HTMLElement;
    const move = row.querySelector('.pb-move') as HTMLElement;
    expect(move).not.toBeNull();
    expect(within(move).getByLabelText('Move ZZ 331 to')).toBeInTheDocument();
    expect(within(move).getByRole('button', { name: 'Move ZZ 331' })).toBeInTheDocument();
    expect(move.contains(within(row).getByRole('button', { name: 'Remove ZZ 331' }))).toBe(false);
    expect(row.querySelector('details')).toBeNull(); // not folded away: the keyboard and a screen reader reach it as before
  });

  it('shows the load by semester once, without a colour key printed under it', async () => {
    const { container } = render();
    await screen.findByRole('region', { name: II });
    expect(container.querySelector('.pb-heat')).toBeNull(); // the plan page shows load on each semester; the strip is not repeated above it
    expect(container.querySelector('.pb-legend')).toBeNull();
  });

  it('folds the list of what is still needed behind one line, closed until it is wanted', async () => {
    render();
    const progress = await screen.findByRole('region', { name: 'Your plan so far' });
    const fold = await waitForFold(progress);
    expect(fold.open).toBe(false);
    expect(within(fold).getByText(/What is still needed: Open electives/, { selector: 'summary' })).toBeInTheDocument();
    expect(within(fold).getByRole('list', { name: 'Credits still needed' })).toBeInTheDocument();
    expect(progress.textContent).toMatch(/16 credits left for graduation/); // the headline stays in view
  });
});
