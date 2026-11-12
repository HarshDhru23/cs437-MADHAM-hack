/**
 * The calmer Scenarios screens (CP-50): the list is a set of cards under one short sentence, and a scenario reads as three numbered
 * steps (change, what happens, keep or drop) with the server's headline figures first and the full comparison one fold away.
 * Server bodies come from the shared contract examples, as in scenarios.test.tsx; every figure shown is the server's own.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import calendarExample from '../../../../examples/calendar.json';
import internshipExample from '../../../../examples/internship-comparison.json';
import comparisonExample from '../../../../examples/scenario-comparison.json';
import scenarioExample from '../../../../examples/scenario.json';
import type { AcademicPlan, InternshipCase, Scenario, ScenarioComparison, ScenarioEvaluation } from '../../api/types';
import { analysis, plan } from '../../test/fixtures';
import { fakeApi, renderApp } from '../../test/harness';
import { resetKeptScenarioDrafts, ScenarioPage } from './ScenarioPage';
import { ScenariosPage } from './ScenariosPage';

const exampleCases = internshipExample.data.cases as unknown as InternshipCase[];
const exampleComparison = comparisonExample.data.comparisons[0] as unknown as ScenarioComparison;

const baseScenario: Scenario = {
  ...(structuredClone(scenarioExample.data) as unknown as Scenario),
  id: 'sc-1',
  plan_id: plan.id,
  label: 'Lighter third year',
  baseline_record_revision: 3,
  baseline_plan_revision: plan.revision,
  rule_version: 'cse-2024-v1',
  changes: [],
  internship: null,
};

interface Figures {
  /** What the server rounds the CPI to (null: no rounding policy yet). */
  cpi?: string | null;
  baselineCpi?: string | null;
  completion?: string | null;
  baselineCompletion?: string | null;
}

function server(opts: { scenario?: Partial<Scenario>; others?: Scenario[]; figures?: Figures } = {}) {
  const current: Scenario = { ...structuredClone(baseScenario), ...opts.scenario };
  const f = opts.figures ?? {};
  const withFigures = (evaluation: ScenarioEvaluation, cpi: string | null | undefined, completion: string | null | undefined): ScenarioEvaluation => {
    const copy = structuredClone(evaluation);
    copy.performance = { ...structuredClone(analysis.performance), cumulative: { ...structuredClone(analysis.performance.cumulative), display_value: cpi ?? null } } as ScenarioEvaluation['performance'];
    copy.validation = { ...copy.validation!, completion_term: completion ?? null } as ScenarioEvaluation['validation'];
    return copy;
  };
  const comparison = (s: Scenario): ScenarioComparison => ({
    ...structuredClone(exampleComparison),
    scenario_id: s.id,
    baseline_record_revision: 3,
    baseline_plan_revision: plan.revision,
    stale: false,
    baseline: withFigures(exampleComparison.baseline!, f.baselineCpi, f.baselineCompletion),
    scenario: {
      ...withFigures(exampleComparison.scenario!, f.cpi, f.completion),
      internship: s.internship ? { ...structuredClone(exampleCases.find((c) => c.duration_choice === s.internship!.duration_choice)!), modules: [] } : null,
    },
  });
  const second: AcademicPlan = { ...structuredClone(plan), id: 'plan-2', label: 'Second plan', revision: 5 };
  const api = fakeApi({
    'GET /plans': () => ({ data: [plan, second] }),
    'GET /calendar': () => ({ data: calendarExample.data }),
    'GET /plans/:id': () => ({ data: plan }),
    'GET /scenarios': () => ({ data: { scenarios: [current, ...(opts.others ?? [])] } }),
    'GET /scenarios/:id': () => ({ data: current }),
    'POST /scenarios/compare': () => ({ data: { comparisons: [comparison(current)], internship_cases: [] }, issues: [] }),
  });
  return api;
}

beforeEach(() => resetKeptScenarioDrafts());
const wait = { timeout: 4000 };
const renderScenario = (api: ReturnType<typeof server>) => renderApp(<ScenarioPage />, { fetchImpl: api.fetchImpl, route: '/scenarios/sc-1', path: '/scenarios/:scenario_id' });

describe('The Scenarios list as cards (CP-50)', () => {
  it('shows each scenario as a card with its name, the plan it copies, its number of changes and its internship choice, under one short sentence', async () => {
    const changes: Scenario['changes'] = [{ op: 'drop', item_id: 'c-os' }, { op: 'drop', item_id: 'c-net' }];
    const api = server({ scenario: { changes, plan_id: 'plan-2' } });
    renderApp(<ScenariosPage />, { fetchImpl: api.fetchImpl, route: '/scenarios', path: '/scenarios' });
    const list = await screen.findByRole('list', { name: 'Your scenarios' }, wait);
    const card = within(list).getAllByRole('listitem')[0]!;
    expect(card).toHaveClass('scenario-card');
    expect(within(card).getByRole('link', { name: 'Lighter third year' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Second plan');
    expect(card).toHaveTextContent('2 changes');
    expect(card).toHaveTextContent(/internship: not chosen/i);
    expect(within(card).getByRole('button', { name: 'Delete scenario Lighter third year' })).toBeInTheDocument();
    const intro = screen.getByRole('heading', { level: 1, name: 'Scenarios' }).nextElementSibling!;
    expect(intro.tagName).toBe('P');
    expect((intro.textContent ?? '').length).toBeLessThan(120);
    expect(intro).not.toHaveTextContent(/internship choices in a scenario never change/);
  });

  it('says "1 change" for one change and "No changes yet" for none', async () => {
    const api = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }] }, others: [{ ...structuredClone(baseScenario), id: 'sc-2', label: 'Untouched copy' }] });
    renderApp(<ScenariosPage />, { fetchImpl: api.fetchImpl, route: '/scenarios', path: '/scenarios' });
    const list = await screen.findByRole('list', { name: 'Your scenarios' }, wait);
    const [one, none] = within(list).getAllByRole('listitem');
    expect(one).toHaveTextContent('1 change');
    expect(one).not.toHaveTextContent('1 changes');
    expect(none).toHaveTextContent('No changes yet');
  });
});

describe('A scenario as three steps (CP-50)', () => {
  it('reads as three numbered steps in order: what would you change, what happens, keep it or drop it', async () => {
    renderScenario(server());
    const steps = await screen.findByRole('list', { name: 'Scenario steps' }, wait);
    expect(steps.tagName).toBe('OL');
    const headings = within(steps).getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['What would you change?', 'What happens', 'Keep it or drop it']);
    // The change form sits in the first step and Apply / Delete in the last.
    const [first, , last] = within(steps).getAllByRole('listitem', {}).filter((li) => li.parentElement === steps);
    expect(within(first!).getByRole('form', { name: 'Add a hypothetical change' })).toBeInTheDocument();
    expect(within(last!).getByRole('button', { name: 'Apply to plan…' })).toBeInTheDocument();
    expect(within(last!).getByRole('button', { name: 'Delete scenario…' })).toBeInTheDocument();
  });

  it('keeps the banner to one short line that still names the plan, with no creation date', async () => {
    renderScenario(server());
    const banner = await screen.findByRole('region', { name: 'Scenario (hypothetical)' }, wait);
    expect(banner).toHaveTextContent('What-if: Lighter third year. Your record and plans stay unchanged until you apply it.');
    expect(banner).toHaveTextContent('Based on plan');
    expect(banner).not.toHaveTextContent('Created');
  });

  it('shows the server CPI and finishing term first, each with a plain note when it differs from the plan', async () => {
    renderScenario(server({ figures: { cpi: '8.40', baselineCpi: '8.85', completion: '2028-29-I', baselineCompletion: '2027-28-II' } }));
    const strip = await screen.findByRole('group', { name: 'What happens in brief' }, wait);
    const cpi = within(strip).getByText('CPI').closest('.scn-figure')!;
    expect(cpi).toHaveTextContent('8.40');
    expect(cpi).toHaveTextContent('Your plan: 8.85');
    const finish = within(strip).getByText('You finish').closest('.scn-figure')!;
    expect(finish).toHaveTextContent('2028–29 Semester I');
    expect(finish).toHaveTextContent('Your plan: 2027–28 Semester II');
    // The third figure is the server's credits per semester.
    expect(within(strip).getByText('Credits per semester').closest('.scn-figure')).toHaveTextContent('2026–27 Semester I');
  });

  it('says "No change" when the server\'s figure equals the plan\'s, and a dash when it has none', async () => {
    renderScenario(server({ figures: { cpi: '8.85', baselineCpi: '8.85', completion: null, baselineCompletion: null } }));
    const strip = await screen.findByRole('group', { name: 'What happens in brief' }, wait);
    const cpi = within(strip).getByText('CPI').closest('.scn-figure')!;
    expect(cpi).toHaveTextContent('8.85');
    expect(cpi).toHaveTextContent('No change');
    const finish = within(strip).getByText('You finish').closest('.scn-figure')!;
    expect(finish).toHaveTextContent('—');
    expect(finish).not.toHaveTextContent('No change');
  });

  it('puts the full comparison, the things to check and the internship panels in one fold titled Full comparison', async () => {
    renderScenario(server({ scenario: { internship: { duration_choice: 'three_months', preset: 'custom', start_date: '2027-05-01', end_date_exclusive: '2027-08-01', placement_mode: 'onsite_full_time', modules: [] } } }));
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    const fold = screen.getByText('Full comparison').closest('details')!;
    expect(fold).not.toBeNull();
    expect(within(fold).getByRole('table', { name: 'Baseline vs scenario' })).toBeInTheDocument();
    await waitFor(() => expect(within(fold).getByRole('region', { name: 'Proposed academic credit' })).toBeInTheDocument());
    // It starts open, so nothing is hidden from a keyboard or a browser test; a student can fold it away.
    expect(fold).toHaveAttribute('open');
  });

  it('shows no decision numbers or upper-case codes anywhere on the page', async () => {
    renderScenario(server({ figures: { cpi: '8.40', baselineCpi: '8.85', completion: '2028-29-I', baselineCompletion: '2027-28-II' } }));
    await screen.findByRole('group', { name: 'What happens in brief' }, wait);
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/D-\d\d/);
    expect(page).not.toMatch(/\b[A-Z]{3,}_[A-Z_]+\b/);
  });

  it('keeps Delete scenario at the top and Apply to plan disabled until the scenario has a plan edit', async () => {
    renderScenario(server());
    expect(await screen.findByRole('button', { name: 'Delete scenario' }, wait)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply to plan…' })).toBeDisabled();
    expect(screen.getByText('This scenario has no plan edits to apply.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete scenario' }));
    expect(screen.getByRole('dialog', { name: 'Delete scenario' })).toBeInTheDocument();
  });
});
