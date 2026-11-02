import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import reviewed from '../../../../data/curricula/cse-2024.json';
import type { Curriculum, RequirementResult } from '../../api/types';
import { fakeApi, renderApp } from '../../test/harness';
import { RequirementsPage } from './RequirementsPage';
import { indexDefinitions, RequirementTree } from './RequirementTree';

// Expected values come from the reviewed rules in data/curricula/cse-2024.json (ADV13 pages, TEAM decisions D-03, D-16).
const curriculum = reviewed as unknown as Curriculum;
const publicRoutes = { 'GET /curricula/cse-2024': () => ({ data: curriculum, issues: [] }) };

describe('Requirements view on the reviewed ADV13 rules (A05)', () => {
  it('labels TEAM decisions and shows where each rule sits in the source', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const list = await screen.findByRole('list', { name: 'Requirements' });
    const tools = within(list).getByRole('heading', { name: 'Software Tools and Techniques for CSE' }).closest('li') as HTMLElement;
    expect(within(tools).getByText('CoursePath team decision D-03')).toBeInTheDocument();
    const core = within(list).getByRole('heading', { name: 'CSE core' }).closest('li') as HTMLElement;
    expect(within(core.querySelector('.req-head') as HTMLElement).queryByText(/CoursePath team decision/)).toBeNull(); // cse-core cites ADV13 only

    await userEvent.click(within(core).getByRole('button', { name: 'Details for CSE core' }));
    expect(within(core).getByText(/p\. 14; codes from p\. 23/)).toBeInTheDocument();
    await userEvent.click(within(core).getByRole('button', { name: 'Why? CSE core' }));
    expect(within(screen.getByRole('dialog', { name: /CSE core/ })).getByText(/p\. 14; codes from p\. 23/)).toBeInTheDocument();
  });

  it('shows the viva with its own label, a readable reviewed policy and its decision', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const section = await screen.findByRole('region', { name: 'Non-credit obligations' });
    expect(within(section).getByText('Comprehensive viva voce (P in every active semester)')).toBeInTheDocument();
    expect(within(section).getByText('CoursePath team decision D-16')).toBeInTheDocument();
    expect(section).toHaveTextContent('A P is required in every active semester');
    expect(section).not.toHaveTextContent('pass_each_active_semester');
    expect(section).not.toHaveTextContent('not yet reviewed');
  });

  it('shows the server surplus and the semesters still missing a viva P, without computing either', () => {
    const results: RequirementResult[] = [
      { id: 'open-electives', status: 'satisfied', required_credits: '24', counted_credits: '24', remaining_credits: '0', surplus_credits: '4', allocation_ids: [], source_refs: [], children: [] },
      { id: 'cse-core', status: 'pending', required_credits: '36', counted_credits: '20', remaining_credits: '16', surplus_credits: '0', allocation_ids: [], source_refs: [], children: [] },
      { id: 'viva', label: 'Comprehensive viva', status: 'pending', missing_terms: ['2025-26-I', '2025-26-II'], allocation_ids: [], source_refs: [], children: [] },
    ];
    render(<RequirementTree definitions={indexDefinitions(curriculum)} results={results} ledger={[]} onWhy={vi.fn()} label="Requirements" />);
    const row = (name: string) => screen.getByRole('heading', { name }).closest('li') as HTMLElement;
    expect(row('Open electives')).toHaveTextContent('Surplus: 4 credits');
    expect(row('CSE core')).not.toHaveTextContent('Surplus');
    expect(within(row('Comprehensive viva')).getByText(/No P recorded yet for/)).toHaveTextContent('2025–26 Semester I, 2025–26 Semester II');
  });
});
