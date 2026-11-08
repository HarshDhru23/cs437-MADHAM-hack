import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import reviewed from '../../../../data/curricula/cse-2024.json';
import type { Catalogue, Curriculum } from '../../api/types';
import { analysis, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { RequirementsPage } from './RequirementsPage';

// Expected values come from the reviewed rules in data/curricula/cse-2024.json (ADV13 pages).
const curriculum = reviewed as unknown as Curriculum;
const catalogue: Catalogue = {
  coverage: 'partial',
  review_status: 'reviewed',
  courses: [
    { id: 'a', normalized_code: 'HS 103', title: 'Synthetic humanities course', credits: '4', baskets: ['hss-other'], could_satisfy: ['HSS electives'] },
    { id: 'b', normalized_code: 'MA 204', title: 'Synthetic maths basket course', credits: '2', baskets: ['math-choice'], could_satisfy: ['Mathematics basket'] },
  ],
};
const publicRoutes = { 'GET /curricula/cse-2024': () => ({ data: curriculum, issues: [] }), 'GET /catalogue': () => ({ data: catalogue, issues: [] }) };
const DEVELOPER_TEXT = /D-\d\d|team decision|p\. \d+|ADV13|[A-Z]{3,}_[A-Z_]{3,}|review status|Rule set|cse-2024-v1|BTECH_CSE/;

describe('Requirements view on the reviewed ADV13 rules (A05)', () => {
  it('opens a group to list its courses with titles: Institute core, HSS and Mathematics', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const list = await screen.findByRole('list', { name: 'Requirements' });
    const group = (name: string) => within(list).getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}\\d`) });
    const HSS = 'Humanities and Social Sciences (GE included)';

    await userEvent.click(group('Institute core'));
    const core = group('Institute core').closest('li') as HTMLElement;
    expect(within(core).getByText('ES 101')).toBeInTheDocument();
    expect(within(core).getByText('Engineering Graphics')).toBeInTheDocument();

    await userEvent.click(group(HSS));
    const hss = group(HSS).closest('li') as HTMLElement;
    expect(within(hss).getByText('HS 191')).toBeInTheDocument();
    await userEvent.click(within(hss).getByRole('button', { name: /^HSS electives/ }));
    expect(within(hss).getByText('HS 103')).toBeInTheDocument(); // from the catalogue, for the HSS electives basket

    await userEvent.click(group('Mathematics'));
    const math = group('Mathematics').closest('li') as HTMLElement;
    for (const code of ['MA 103', 'MA 104', 'MA 203']) expect(within(math).getByText(code)).toBeInTheDocument();
    await userEvent.click(within(math).getByRole('button', { name: /^Mathematics basket/ }));
    expect(within(math).getByText('MA 204')).toBeInTheDocument();
  });

  it('says open electives take any course instead of listing every course', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const list = await screen.findByRole('list', { name: 'Requirements' });
    await userEvent.click(within(list).getByRole('button', { name: /^Open electives/ }));
    expect(within(list).getByText('Any course that is not needed for another requirement.')).toBeInTheDocument();
  });

  it('shows no decision ids, page references, issue codes or rule versions anywhere', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    const list = await screen.findByRole('list', { name: 'Requirements' });
    for (const button of within(list).getAllByRole('button', { name: /credits/ })) await userEvent.click(button);
    expect(container.textContent).not.toMatch(DEVELOPER_TEXT);
    expect(screen.queryByRole('button', { name: /^Why\?/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unresolved decisions and issues' })).not.toBeInTheDocument();
  });

  it('lists physical education and the viva in plain words, with no policy codes', async () => {
    const { fetchImpl } = fakeApi(publicRoutes, null);
    renderApp(<RequirementsPage />, { fetchImpl });
    const section = await screen.findByRole('region', { name: 'Other requirements' });
    expect(section).toHaveTextContent('Physical education — one PE course in each of 4 semesters');
    expect(section).toHaveTextContent('Comprehensive viva — a pass (P) recorded in every semester you are enrolled');
    expect(section.textContent).not.toMatch(DEVELOPER_TEXT);
    expect(section).not.toHaveTextContent('pass_each_active_semester');
  });

  it('names the semesters still missing a viva pass from the server result, and never shows surplus jargon', async () => {
    const viva = { id: 'viva', label: 'Comprehensive viva', status: 'pending' as const, missing_terms: ['2025-26-I', '2025-26-II'], allocation_ids: [], source_refs: [], children: [] };
    const withViva = { ...analysis, audit: { ...analysis.audit, actual: [...analysis.audit.actual, viva] } };
    const { fetchImpl } = fakeApi({ ...publicRoutes, 'GET /record': () => ({ data: record }), 'GET /plans': () => ({ data: [plan] }), 'POST /analysis': () => ({ data: withViva }) });
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    const section = await screen.findByRole('region', { name: 'Other requirements' });
    await screen.findByRole('region', { name: 'Overview' });
    expect(section).toHaveTextContent('No viva pass recorded yet for: 2025–26 Semester I, 2025–26 Semester II.');
    expect(container.textContent).not.toMatch(/Surplus/);
  });
});
