/**
 * The plan area as a board: semester columns with load meters, the load strip, and generating from the command bar (/plan?generate=1).
 * Every number is the server's (the fake answers differ from any browser-side sum); the UI only picks a colour step and formats.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import generationExample from '../../../../examples/plan-generation.json';
import checkExample from '../../../../examples/plan-check.json';
import type { PlanCheck, PlanValidation } from '../../api/types';
import { curriculum, plan, record } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { loadLevel, meterLevel, meterWidth, shortTerm, sumCredits } from './loadLevel';
import { PlanLoadStrip } from './PlanLoadStrip';
import { PlanIndexPage } from './PlanPage';

const generation = generationExample.data;
const emptyValidation = { workload: {}, per_course: [], issues: [], meeting_check_status: 'not_checked', completion_term: null } as PlanValidation;

function check(load: PlanCheck['load']): PlanCheck {
  return { ...(checkExample.data as unknown as PlanCheck), validation: emptyValidation, load };
}

function server(opts: { load?: PlanCheck['load']; record?: typeof record } = {}) {
  const load = opts.load ?? { '2026-27-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' }, '2027-28-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' } };
  return fakeApi({
    'GET /record': () => ({ data: opts.record ?? record }),
    'GET /curricula/cse-2024': () => ({ data: curriculum }),
    'GET /catalogue': () => ({ data: { courses: [], coverage: 'partial', review_status: 'reviewed' }, issues: [] }),
    'GET /plans': () => ({ data: [] }),
    'GET /plans/:id': () => ({ data: plan }),
    'POST /plans/:id/validate': () => ({ data: emptyValidation }),
    'POST /plans/generate': () => ({ data: generation, issues: generationExample.issues }),
    'POST /plans/check': () => ({ data: check(load) }),
  });
}

function Where() {
  const { search } = useLocation();
  return <p data-testid="where">{search}</p>;
}

const renderAt = (s: ReturnType<typeof server>, route: string) => renderApp(<><PlanIndexPage /><Where /></>, { fetchImpl: s.fetchImpl, route, path: '/plan' });
const generates = (s: ReturnType<typeof server>) => s.calls.filter((c) => c.method === 'POST' && c.path === '/plans/generate');

describe('load levels', () => {
  it('steps the load strip: nothing, light below half, normal, heavy from 85% to the limit, over above it', () => {
    expect(loadLevel('0', '28')).toBe('empty');
    expect(loadLevel('13', '28')).toBe('light'); // 46%
    expect(loadLevel('14', '28')).toBe('normal'); // exactly half
    expect(loadLevel('23', '28')).toBe('normal'); // 82%
    expect(loadLevel('24', '28')).toBe('heavy'); // 85.7%
    expect(loadLevel('28', '28')).toBe('heavy'); // at the limit is not over it
    expect(loadLevel('29', '28')).toBe('over');
    expect(loadLevel('10', '10')).toBe('heavy');
    expect(loadLevel('11', '10')).toBe('over'); // a summer break holds 10
  });

  it('steps a column meter: cyan below 85%, amber up to the limit, red over it', () => {
    expect(meterLevel('8', '28')).toBe('ok');
    expect(meterLevel('23', '28')).toBe('ok');
    expect(meterLevel('24', '28')).toBe('warn');
    expect(meterLevel('28', '28')).toBe('warn');
    expect(meterLevel('28.5', '28')).toBe('over');
  });

  it('draws a bar of the right width and never wider than the column', () => {
    expect(meterWidth('14', '28')).toBe(50);
    expect(meterWidth('0', '28')).toBe(0);
    expect(meterWidth('32', '28')).toBe(100);
  });

  it('treats a missing or unusable number as empty and cyan, never as over', () => {
    expect(loadLevel(undefined, '28')).toBe('empty');
    expect(loadLevel('abc', '28')).toBe('empty');
    expect(loadLevel('5', '0')).toBe('empty');
    expect(meterLevel(undefined, '28')).toBe('ok');
    expect(meterWidth(undefined, '28')).toBe(0);
  });

  it('shortens term names for the strip, and adds credits exactly', () => {
    expect(shortTerm('2026-27-I')).toBe('26–27 I');
    expect(shortTerm('2026-27-II')).toBe('26–27 II');
    expect(shortTerm('2026-27-SUMMER')).toBe('26–27 Summer');
    expect(sumCredits(['28', '28', '10'])).toBe('66');
    expect(sumCredits(['0.1', '0.2'])).toBe('0.3'); // no float noise
    expect(sumCredits([])).toBe('0');
  });
});

describe('PlanLoadStrip', () => {
  const cells = [
    { term: '2026-27-I', planned: '28', limit: '28' },
    { term: '2026-27-II', planned: '30', limit: '28' },
    { term: '2026-27-SUMMER', planned: '6', limit: '10' },
    { term: '2027-28-I', planned: '0', limit: '28' },
  ];

  it('shows one labelled cell per semester, summer breaks included, with the credits out of the limit', () => {
    render(<PlanLoadStrip cells={cells} />);
    const strip = screen.getByRole('group', { name: 'Load by semester' });
    const items = within(strip).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items.map((li) => li.getAttribute('data-level'))).toEqual(['heavy', 'over', 'normal', 'empty']);
    expect(items[0]).toHaveTextContent('26–27 I');
    expect(items[0]).toHaveTextContent('28 / 28');
    expect(items[2]).toHaveTextContent('26–27 Summer');
    expect(items[2]).toHaveTextContent('6 / 10');
  });

  it('says the load in words as well as colour', () => {
    render(<PlanLoadStrip cells={cells} />);
    const items = within(screen.getByRole('group', { name: 'Load by semester' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('heavy load');
    expect(items[1]).toHaveTextContent('over the limit');
    expect(items[3]).toHaveTextContent('nothing planned');
    expect(items[1]).toHaveAttribute('title', '2026–27 Semester II: 30 of 28 credits, over the limit');
  });

  it('is a summary, not a control', () => {
    render(<PlanLoadStrip cells={cells} />);
    expect(within(screen.getByRole('group', { name: 'Load by semester' })).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing for a plan with no semesters', () => {
    const { container } = render(<PlanLoadStrip cells={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the draft as a board', () => {
  it('shows one column per semester with a load meter and the load strip above it, all from the server check', async () => {
    const s = server({
      load: {
        '2026-27-I': { planned_credits: '8', limit_credits: '28', available_credits: '20' },
        '2027-28-I': { planned_credits: '24', limit_credits: '28', available_credits: '4' },
      },
    });
    renderAt(s, '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    await waitFor(() => expect(within(draft).getByText('Semester total: 24 / 28 credits')).toBeInTheDocument());
    const columns = within(draft).getAllByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ });
    expect(columns).toHaveLength(generation.semesters.length);
    expect(columns[0]!.querySelector('.pb-meter')).toHaveAttribute('data-level', 'ok'); // 8 of 28
    expect(columns[1]!.querySelector('.pb-meter')).toHaveAttribute('data-level', 'warn'); // 24 of 28
    expect((columns[1]!.querySelector('.pb-meter > i') as HTMLElement).style.width).toBe('86%');
    const strip = within(draft).getByRole('group', { name: 'Load by semester' });
    expect(within(strip).getAllByRole('listitem').map((li) => li.getAttribute('data-level'))).toEqual(['light', 'heavy']);
  });

  it('turns a column and its strip cell red when the server counts more than the limit', async () => {
    const s = server({
      load: {
        '2026-27-I': { planned_credits: '32', limit_credits: '28', available_credits: '0' },
        '2027-28-I': { planned_credits: '12', limit_credits: '28', available_credits: '16' },
      },
    });
    renderAt(s, '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    await waitFor(() => expect(within(draft).getByText('Semester total: 32 / 28 credits')).toBeInTheDocument());
    const first = within(draft).getAllByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ })[0]!;
    expect(first.querySelector('.pb-meter')).toHaveAttribute('data-level', 'over');
    expect((first.querySelector('.pb-meter > i') as HTMLElement).style.width).toBe('100%');
    const cell = within(within(draft).getByRole('group', { name: 'Load by semester' })).getAllByRole('listitem')[0]!;
    expect(cell).toHaveAttribute('data-level', 'over');
    expect(cell).toHaveTextContent('32 / 28');
  });

  it('keeps each column a real table with a row per course, so a screen reader still hears course, credits and what it counts toward', async () => {
    renderAt(server(), '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    const first = within(draft).getAllByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ })[0]!;
    const table = within(first).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Course', 'Title', 'Credits', 'Counts toward', 'Actions']);
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
  });

  it('puts the toolbar (internship, credits, name) and the Save, Reset and Discard actions together above the board', async () => {
    renderAt(server(), '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    const toolbar = within(draft).getByRole('group', { name: 'Draft settings' });
    expect(within(toolbar).getByLabelText('Internship semester')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Credits per semester')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Plan name')).toHaveAttribute('type', 'text');
    for (const name of ['Save as my plan', 'Reset to generated plan', 'Discard']) expect(within(toolbar).getByRole('button', { name })).toBeInTheDocument();
    const firstColumn = within(draft).getAllByRole('region', { name: /^Draft 20\d\d–\d\d Semester/ })[0]!;
    expect(toolbar.compareDocumentPosition(firstColumn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the plan total as a readout next to the credits left for graduation', async () => {
    renderAt(server(), '/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate plan' }));
    const draft = await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    // two semesters of 8 credits each, as the server counted them
    expect(await within(draft).findByText('16 credits')).toBeInTheDocument();
    expect(within(draft).getByText(/in the plan/)).toBeInTheDocument();
  });
});

describe('generating from the command bar (/plan?generate=1)', () => {
  it('generates once without a click, then drops the parameter so a reload does not generate again', async () => {
    const s = server();
    renderAt(s, '/plan?generate=1');
    expect(await screen.findByRole('region', { name: 'Draft plan (not saved)' })).toBeInTheDocument();
    expect(generates(s)).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^$/));
    await new Promise((r) => setTimeout(r, 200));
    expect(generates(s)).toHaveLength(1); // still one: the parameter is gone and nothing restarts
  });

  it('still generates when React mounts, unmounts and mounts the page again (strict mode, as the app and the dev server run it)', async () => {
    const s = server();
    // A request whose signal is aborted fails, as a real browser's fetch does (the fake would otherwise answer a cancelled request).
    const honoringAbort: typeof fetch = (input, init) =>
      new Promise((resolve, reject) => {
        const gone = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init?.signal?.aborted) return gone();
        init?.signal?.addEventListener('abort', gone);
        s.fetchImpl(input, init).then(resolve, reject);
      });
    renderApp(<StrictMode><PlanIndexPage /><Where /></StrictMode>, { fetchImpl: honoringAbort, route: '/plan?generate=1', path: '/plan' });
    expect(await screen.findByRole('region', { name: 'Draft plan (not saved)' })).toBeInTheDocument();
    expect(screen.queryByText(/Building your plan/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^$/));
  });

  it('keeps other parameters when it drops its own', async () => {
    const s = server();
    renderAt(s, '/plan?generate=1&from=palette');
    await screen.findByRole('region', { name: 'Draft plan (not saved)' });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?from=palette'));
  });

  it('does nothing on a plain /plan, or when the value is not 1', async () => {
    for (const route of ['/plan', '/plan?generate=0', '/plan?generate=true']) {
      const s = server();
      const view = renderAt(s, route);
      await screen.findByRole('button', { name: 'Generate plan' });
      await new Promise((r) => setTimeout(r, 150));
      expect(generates(s), route).toHaveLength(0);
      expect(screen.queryByRole('region', { name: 'Draft plan (not saved)' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('does not generate without a record: the page points to the import and the parameter is still dropped', async () => {
    const s = server({ record: { ...record, attempts: [], current_enrolment: [] } });
    renderAt(s, '/plan?generate=1');
    expect(await screen.findByText(/Add your record first/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^$/));
    expect(generates(s)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Generate plan' })).toBeDisabled();
  });
});
