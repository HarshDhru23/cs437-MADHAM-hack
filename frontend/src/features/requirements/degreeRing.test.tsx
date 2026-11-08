import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { analysis, catalogue, curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { DegreeRing, type RingGroup } from './DegreeRing';
import { RequirementsPage } from './RequirementsPage';

const routes = {
  'GET /curricula/cse-2024': () => ({ data: curriculum }),
  'GET /catalogue': () => ({ data: catalogue, issues: [] }),
  'GET /record': () => ({ data: record }),
  'GET /plans': () => ({ data: [plan] }),
  'POST /analysis': () => ({ data: analysis, issues: analysis.audit.issues }),
};

// The fixture curriculum has five credit-bearing groups: HSS 28, Science basket 8, BS elective 4, CSE core 36 and CSE electives 26.
const GROUP_COUNT = 5;
const arcs = (container: HTMLElement) => [...container.querySelectorAll<SVGGElement>('[data-ring-arc]')];
const fillOf = (arc: Element) => arc.querySelector<SVGPathElement>('.ring-fill')!;

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});
const preferReducedMotion = () => {
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
};

describe('Degree ring on the requirements page', () => {
  it('has one arc per requirement group and an accessible summary of the counted credits', async () => {
    const { fetchImpl } = fakeApi(routes);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    const overview = await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    expect(arcs(container)).toHaveLength(GROUP_COUNT);
    expect(within(overview).getByRole('img', { name: /^104 of 170 degree credits counted, across 5 requirement groups$/ })).toBeInTheDocument();
  });

  it('shows the credits counted in the centre, as the server reports them, and follows the view', async () => {
    const { fetchImpl } = fakeApi(routes);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    expect(container.querySelector('.ring-number')).toHaveTextContent('104');
    expect(container.querySelector('.ring-of')).toHaveTextContent('of 170 credits');
    await userEvent.click(screen.getByRole('radio', { name: 'Completed + current courses' }));
    expect(container.querySelector('.ring-number')).toHaveTextContent('108');
  });

  it('fills each arc by the share of its group that is counted, never beyond the whole arc', async () => {
    const { fetchImpl } = fakeApi(routes);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    const core = arcs(container).find((a) => a.getAttribute('data-ring-arc') === 'cse-core')!;
    expect(Number(fillOf(core).getAttribute('stroke-dashoffset'))).toBeCloseTo(1 - 4 / 36, 4); // 4 of 36 credits counted (hand count from the fixture)
    const electives = arcs(container).find((a) => a.getAttribute('data-ring-arc') === 'cse-electives')!;
    expect(Number(fillOf(electives).getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 4); // 26 of 26 counted: a full arc
    // The ring never decides a group is done: the fixture's server status for the electives is "needs review", so the arc stays cyan.
    expect(fillOf(electives)).not.toHaveAttribute('data-done');
    expect(fillOf(core)).not.toHaveAttribute('data-done');
  });

  it('turns an arc mint only when the server says the group is satisfied', async () => {
    const satisfied = { ...analysis, audit: { ...analysis.audit, actual: analysis.audit.actual.map((n) => (n.id === 'cse-electives' ? { ...n, status: 'satisfied' as const } : n)) } };
    const { fetchImpl } = fakeApi({ ...routes, 'POST /analysis': () => ({ data: satisfied }) });
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    const electives = arcs(container).find((a) => a.getAttribute('data-ring-arc') === 'cse-electives')!;
    expect(fillOf(electives)).toHaveAttribute('data-done', 'true');
  });

  it('highlights an arc and its row together, and names the group underneath', async () => {
    const { fetchImpl } = fakeApi(routes);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    const list = screen.getByRole('list', { name: 'Requirements' });
    const row = list.querySelector('[data-requirement="cse-core"] .req-row') as HTMLElement;
    const arc = arcs(container).find((a) => a.getAttribute('data-ring-arc') === 'cse-core')!;
    expect(row).not.toHaveAttribute('data-highlight');
    await userEvent.hover(arc);
    expect(row).toHaveAttribute('data-highlight', 'true');
    expect(arc).toHaveAttribute('data-highlight', 'true');
    expect(container.querySelector('.ring-caption')).toHaveTextContent(/Cse core · 4 \/ 36/);
    await userEvent.unhover(arc);
    expect(row).not.toHaveAttribute('data-highlight');
    expect(container.querySelector('.ring-caption')).not.toHaveTextContent(/Cse core/);
  });

  it('highlights the arc when its row is focused with the keyboard', async () => {
    const { fetchImpl } = fakeApi(routes);
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    const list = screen.getByRole('list', { name: 'Requirements' });
    const button = within(list).getByRole('button', { name: /^HSS/ });
    const arc = arcs(container).find((a) => a.getAttribute('data-ring-arc') === 'hss')!;
    act(() => button.focus());
    expect(arc).toHaveAttribute('data-highlight', 'true');
    act(() => button.blur());
    expect(arc).not.toHaveAttribute('data-highlight');
  });

  it('draws empty arcs and no counted number before there is a record', async () => {
    const { fetchImpl } = fakeApi({ ...routes, 'GET /record': () => ({ data: { ...record, attempts: [], revision: 0 } }) });
    const { container } = renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('link', { name: 'Add my record' }, { timeout: 5000 });
    expect(arcs(container)).toHaveLength(GROUP_COUNT);
    for (const arc of arcs(container)) expect(Number(fillOf(arc).getAttribute('stroke-dashoffset'))).toBe(1);
    expect(screen.getByRole('img', { name: /^170 degree credits in 5 requirement groups$/ })).toBeInTheDocument();
    expect(container.querySelector('.ring-number')).toHaveTextContent('170');
    expect(container.querySelector('.ring-of')).not.toHaveTextContent(/of 170/);
    expect(container.querySelector('.ring-figure, .ring')).not.toHaveTextContent(/104|counted/);
  });
});

describe('DegreeRing', () => {
  const groups: RingGroup[] = [
    { id: 'a', label: 'Alpha', required: '30', counted: '30', done: true },
    { id: 'b', label: 'Beta', required: '10', counted: '5', done: false },
  ];

  it('fills the arcs straight away when the student asked for less motion', () => {
    preferReducedMotion();
    const { container } = render(<DegreeRing groups={groups} total="40" counted="35" highlightId={null} onHighlight={() => undefined} />);
    expect(container.querySelector('figure')).toHaveAttribute('data-motion', 'reduced');
    const [a, b] = arcs(container).map(fillOf);
    expect(Number(a!.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 4);
    expect(Number(b!.getAttribute('stroke-dashoffset'))).toBeCloseTo(0.5, 4);
    expect(a!.style.transition).toBe('none');
  });

  it('animates the fill once when motion is allowed, ending at the same place', () => {
    const { container } = render(<DegreeRing groups={groups} total="40" counted="35" highlightId={null} onHighlight={() => undefined} />);
    expect(container.querySelector('figure')).toHaveAttribute('data-motion', 'full');
    const [a] = arcs(container).map(fillOf);
    expect(a!.style.transition).not.toBe('none');
  });

  it('draws a count above the requirement as a full arc, not more', () => {
    const over: RingGroup[] = [{ id: 'a', label: 'Alpha', required: '10', counted: '14', done: true }];
    preferReducedMotion();
    const { container } = render(<DegreeRing groups={over} total="10" counted="14" highlightId={null} onHighlight={() => undefined} />);
    expect(Number(fillOf(arcs(container)[0]!).getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 4);
  });

  it('reports the group under the pointer and clears it again', () => {
    const seen: (string | null)[] = [];
    const { container } = render(<DegreeRing groups={groups} total="40" counted="35" highlightId={null} onHighlight={(id) => seen.push(id)} />);
    const [, second] = arcs(container);
    fireEvent.mouseEnter(second!);
    fireEvent.mouseLeave(second!);
    expect(seen).toEqual(['b', null]);
  });

  it('names the group, with its counted credits, in the caption when highlighted', () => {
    render(<DegreeRing groups={groups} total="40" counted="35" highlightId="b" onHighlight={() => undefined} />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/5 \/ 10/)).toBeInTheDocument();
  });
});

describe('Audit view switch', () => {
  it('is a segmented control that works with the arrow keys', async () => {
    const { fetchImpl } = fakeApi(routes);
    renderApp(<RequirementsPage />, { fetchImpl });
    await screen.findByRole('region', { name: 'Overview' }, { timeout: 5000 });
    const group = screen.getByRole('radiogroup', { name: 'Audit view' });
    const completed = within(group).getByRole('radio', { name: 'Completed' });
    completed.focus();
    expect(completed).toBeChecked();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(group).getByRole('radio', { name: 'Completed + current courses' })).toBeChecked();
    expect(completed.closest('label')).not.toHaveAttribute('data-checked');
    expect(within(group).getByRole('radio', { name: 'Completed + current courses' }).closest('label')).toHaveAttribute('data-checked', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(completed).toBeChecked();
  });
});
