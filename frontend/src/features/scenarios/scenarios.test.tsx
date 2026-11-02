/**
 * A09 scenarios against a fake API. Evaluations are built from the shared
 * contract examples (examples/audit.json, plan-validation.json and
 * internship-comparison.json); there is no scenario example yet, so the
 * scenario record and deltas follow coursepath/scenarios.py field for field.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import auditExample from '../../../../examples/audit.json';
import internshipExample from '../../../../examples/internship-comparison.json';
import planValidationExample from '../../../../examples/plan-validation.json';
import type {
  AcademicPlan,
  AuditResult,
  InternshipCase,
  Issue,
  PlanValidation,
  Scenario,
  ScenarioComparison,
  ScenarioEvaluation,
  ScenarioPatch,
} from '../../api/types';
import { analysis, plan } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { ScenarioPage } from './ScenarioPage';
import { ScenariosPage } from './ScenariosPage';

const exampleCases = internshipExample.data.cases as unknown as InternshipCase[];
const exampleCase = (duration: string) => structuredClone(exampleCases.find((c) => c.duration_choice === duration)!);

function evaluation(over: Partial<ScenarioEvaluation> = {}): ScenarioEvaluation {
  return {
    audit: auditExample.data as unknown as AuditResult,
    performance: { ...structuredClone(analysis.performance), hypothetical: false },
    validation: structuredClone(planValidationExample.data) as unknown as PlanValidation,
    internship: null,
    completion_term: null,
    issues: planValidationExample.issues as Issue[],
    ...over,
  };
}

const baseScenario: Scenario = {
  id: 'sc-1',
  revision: 0,
  plan_id: 'plan-1',
  label: 'Lighter third year',
  baseline_record_revision: 3,
  baseline_plan_revision: 2,
  rule_version: 'cse-2024-v1',
  changes: [],
  internship: null,
  award_ids: [],
};

interface ServerOptions {
  scenario?: Partial<Scenario>;
  stale?: boolean;
  conflictPatch?: boolean;
  applyConflict?: { action: string; code: string };
  /** Override the scenario evaluation the fake compare returns. */
  scenarioEval?: (s: Scenario) => Partial<ScenarioEvaluation>;
  plans?: AcademicPlan[];
}

function server(opts: ServerOptions = {}) {
  let current: Scenario = { ...structuredClone(baseScenario), ...opts.scenario };
  let stale = opts.stale ?? false;
  const patches: ScenarioPatch[] = [];
  const applies: unknown[] = [];
  const creates: unknown[] = [];
  const deletes: unknown[] = [];
  let compares = 0;
  const comparison = (s: Scenario): ScenarioComparison =>
    stale
      ? {
          scenario_id: s.id,
          baseline_record_revision: 3,
          baseline_plan_revision: 3,
          rule_version: 'cse-2024-v1',
          stale: true,
          baseline: null,
          scenario: null,
          deltas: null,
          issues: [issue('SCENARIO_STALE', 'error', [s.id], 'The saved record, plan or rules changed after this scenario was created.')],
        }
      : {
          scenario_id: s.id,
          baseline_record_revision: 3,
          baseline_plan_revision: 2,
          rule_version: 'cse-2024-v1',
          stale: false,
          baseline: evaluation(),
          scenario: evaluation({
            performance: { ...structuredClone(analysis.performance), hypothetical: true },
            internship: s.internship ? { ...exampleCase(s.internship.duration_choice), modules: (s.internship.modules ?? []).map((m) => ({ id: m.id, intended_allocation: m.intended_allocation, status: 'proposed', reasons: [] })) } : null,
            ...opts.scenarioEval?.(s),
          }),
          deltas: {
            requirements: [{ id: 'cse-core', label: 'CSE core', baseline: { status: 'pending', remaining_credits: '20' }, scenario: { status: 'pending', remaining_credits: '28' } }],
            new_issues: [],
            resolved_issues: [],
            downstream_affected: [],
            workload: {},
            cpi: { baseline: null, scenario: null, hypothetical: true },
            meeting_checks: {},
          },
          issues: [],
        };
  const api = fakeApi({
    'GET /plans': () => ({ data: opts.plans ?? [plan] }),
    'GET /plans/:id': () => ({ data: plan }),
    'GET /scenarios': () => ({ data: { scenarios: [current] } }),
    'POST /scenarios': (req) => {
      creates.push(req.body);
      return { status: 201, data: { ...baseScenario, id: 'sc-new', ...(req.body as object) } };
    },
    'GET /scenarios/:id': () => ({ data: current }),
    'PATCH /scenarios/:id': (req) => {
      const body = req.body as ScenarioPatch;
      patches.push(body);
      if (opts.conflictPatch || body.expected_revision !== current.revision)
        return { status: 409, data: { current_revision: current.revision + 3, action: 'reload_compare' }, issues: [issue('REVISION_CONFLICT', 'error')] };
      const { expected_revision: _expected, rebase, ...rest } = body;
      current = { ...current, ...rest, revision: current.revision + 1, ...(rebase ? { baseline_plan_revision: 3 } : {}) };
      if (rebase) stale = false;
      return { data: current };
    },
    'DELETE /scenarios/:id': (req) => {
      deletes.push(req.body);
      return { data: null };
    },
    'POST /scenarios/compare': () => {
      compares += 1;
      const cases = current.internship && !stale ? [{ ...exampleCase(current.internship.duration_choice), scenario_id: current.id }] : [];
      return { data: { comparisons: [comparison(current)], internship_cases: cases }, issues: comparison(current).issues };
    },
    'POST /scenarios/:id/apply-plan': (req) => {
      applies.push(req.body);
      if (opts.applyConflict)
        return {
          status: 409,
          data: { current_revision: 3, action: opts.applyConflict.action },
          issues: [issue(opts.applyConflict.code, 'error', [], opts.applyConflict.code === 'SCENARIO_STALE' ? 'The baseline changed.' : 'Reload and compare the newer saved revision.')],
        };
      return {
        data: {
          plan: { ...plan, revision: 3, validation: planValidationExample.data },
          not_applied: [{ op: 'grade', item_id: 'c-net', term_id: null, reason: 'Hypothetical grades, failures and caps never enter a saved plan or the record.' }],
        },
      };
    },
  });
  return {
    fetchImpl: api.fetchImpl,
    calls: api.calls,
    patches,
    applies,
    creates,
    deletes,
    get compares() {
      return compares;
    },
    get current() {
      return current;
    },
  };
}

const renderScenario = (s: ReturnType<typeof server>) => renderApp(<ScenarioPage />, { fetchImpl: s.fetchImpl, route: '/scenarios/sc-1', path: '/scenarios/:scenario_id' });
const wait = { timeout: 4000 };

async function addChange(type: string, fields: (form: HTMLElement) => Promise<void>) {
  const form = screen.getByRole('form', { name: 'Add a hypothetical change' });
  await userEvent.selectOptions(within(form).getByLabelText('Change type'), type);
  await fields(form);
  await userEvent.click(within(form).getByRole('button', { name: 'Add change' }));
}

describe('ScenariosPage (A09, CP-28)', () => {
  it('lists scenarios and creates a named clone of the chosen plan', async () => {
    const second: AcademicPlan = { ...structuredClone(plan), id: 'plan-2', label: 'Second plan', revision: 5 };
    const s = server({ plans: [plan, second] });
    renderApp(<ScenariosPage />, { fetchImpl: s.fetchImpl, route: '/scenarios', path: '/scenarios' });
    const list = await screen.findByRole('list', { name: 'Your scenarios' }, wait);
    expect(within(list).getByRole('link', { name: 'Lighter third year' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Scenario name'), 'Second plan what-if');
    await userEvent.click(screen.getByRole('button', { name: 'Create scenario' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the plan to copy.');
    expect(s.creates).toHaveLength(0);
    await userEvent.selectOptions(screen.getByLabelText('Plan to copy'), 'plan-2');
    await userEvent.click(screen.getByRole('button', { name: 'Create scenario' }));
    await waitFor(() => expect(s.creates).toEqual([{ plan_id: 'plan-2', label: 'Second plan what-if', changes: [] }]));
    expect(await screen.findByText('navigated-away')).toBeInTheDocument();
  });
});

describe('ScenarioPage (A09, CP-28/33/34)', () => {
  it('shows the hypothetical banner with baseline revisions and a return-to-baseline action', async () => {
    const s = server();
    renderScenario(s);
    const banner = await screen.findByRole('region', { name: 'Scenario (hypothetical)' }, wait);
    expect(banner).toHaveTextContent('Baseline record revision3');
    expect(banner).toHaveTextContent('revision 2');
    expect(banner).toHaveTextContent('Not recorded by the server');
    expect(within(banner).getByRole('link', { name: 'Return to baseline' })).toHaveAttribute('href', '/plan/plan-1');
  });

  it('adds typed changes, lists them exactly and saves them with the expected revision', async () => {
    const s = server();
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330 — 2026–27 Semester I/ }, wait);
    await addChange('drop', async (f) => userEvent.selectOptions(within(f).getByLabelText('Planned course'), 'c-os'));
    await addChange('grade', async (f) => {
      await userEvent.selectOptions(within(f).getByLabelText('Planned course'), 'c-net');
      await userEvent.selectOptions(within(f).getByLabelText('Hypothetical letter grade'), 'B');
    });
    await addChange('postpone', async (f) => {
      await userEvent.selectOptions(within(f).getByLabelText('Planned course'), 'c-net');
      await userEvent.selectOptions(within(f).getByLabelText('Later term'), '2027-28-I');
    });
    // A replacement with an invalid code is refused with a specific message; nothing is added.
    await addChange('replace', async (f) => {
      await userEvent.selectOptions(within(f).getByLabelText('Planned course'), 'c-os');
      await userEvent.type(within(f).getByLabelText('Replacement course code'), '???');
      await userEvent.type(within(f).getByLabelText('Replacement credits'), '4');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a course code such as CS 330.');
    const form = screen.getByRole('form', { name: 'Add a hypothetical change' });
    await userEvent.clear(within(form).getByLabelText('Replacement course code'));
    await userEvent.type(within(form).getByLabelText('Replacement course code'), 'zz332');
    await userEvent.click(within(form).getByRole('button', { name: 'Add change' }));
    await addChange('cap', async (f) => {
      await userEvent.selectOptions(within(f).getByLabelText('Term to cap'), '2026-27-II');
      await userEvent.type(within(f).getByLabelText('Credit cap'), '16');
    });
    const listed = screen.getByRole('list', { name: 'Hypothetical changes' });
    expect(within(listed).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual([
      'Drop ZZ 330 (2026–27 Semester I)',
      'Hypothetical grade B for ZZ 331 (2026–27 Semester II)',
      'Postpone ZZ 331 (2026–27 Semester II) to 2027–28 Semester I',
      'Replace ZZ 330 (2026–27 Semester I) with ZZ 332 (4 credits)',
      'Cap 2026–27 Semester II at 16 credits',
    ]);
    expect(screen.getByRole('status', { name: 'Scenario save status' })).toHaveTextContent('Unsaved changes');
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    expect(s.patches[0]).toEqual({
      expected_revision: 0,
      label: 'Lighter third year',
      internship: null,
      changes: [
        { op: 'drop', item_id: 'c-os' },
        { op: 'grade', item_id: 'c-net', grade: 'B' },
        { op: 'postpone', item_id: 'c-net', term_id: '2027-28-I' },
        { op: 'replace', item_id: 'c-os', course: { normalized_code: 'ZZ 332', credits: '4' } },
        { op: 'cap', term_id: '2026-27-II', credits: '16' },
      ],
    });
    expect(await screen.findByRole('status', { name: 'Scenario save status' })).toHaveTextContent('Saved (revision 1)');
  });

  it('shows the conflict panel on a 409 save and never retries automatically', async () => {
    const s = server({ conflictPatch: true });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await addChange('fail', async (f) => userEvent.selectOptions(within(f).getByLabelText('Planned course'), 'c-os'));
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    const panel = (await screen.findByText(/This was saved elsewhere/)).closest('[role="alert"]');
    expect(panel).toHaveTextContent('server revision 3');
    await new Promise((r) => setTimeout(r, 300));
    expect(s.patches).toHaveLength(1);
    // The draft is kept.
    expect(screen.getByRole('list', { name: 'Hypothetical changes' })).toHaveTextContent('Hypothetical fail: ZZ 330');
  });

  it('marks a stale baseline and rebases only when asked, with rebase: true', async () => {
    const s = server({ stale: true });
    renderScenario(s);
    expect(await screen.findByText(/The baseline changed\./, {}, wait)).toBeInTheDocument();
    expect(screen.getAllByRole('alert').some((a) => /Lighter third year: baseline changed\. The saved record, plan or rules changed/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByRole('button', { name: 'Apply to plan…' })).toBeDisabled();
    expect(s.patches).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Rebase on current record and plan' }));
    await waitFor(() => expect(s.patches).toEqual([{ expected_revision: 0, rebase: true }]));
    await waitFor(() => expect(screen.queryByText(/The baseline changed\./)).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Scenario (hypothetical)' })).toHaveTextContent('revision 3');
  });

  it('shows a re-evaluating state while the comparison is out of date', async () => {
    const s = server();
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario (server evaluation)' }, wait);
    await addChange('drop', async (f) => userEvent.selectOptions(within(f).getByLabelText('Planned course'), 'c-os'));
    expect(screen.getByText(/You have unsaved changes\. The results below are for saved revision 0/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Baseline vs scenario (server evaluation)' }).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows Unavailable for missing server values and keeps a real 0 as 0', async () => {
    const s = server({
      scenario: { internship: { duration_choice: 'three_months', preset: 'custom', start_date: '2027-05-01', end_date_exclusive: '2027-08-01', placement_mode: 'onsite_full_time', modules: [] } },
      scenarioEval: () => ({
        performance: { ...structuredClone(analysis.performance), cumulative: { ...structuredClone(analysis.performance.cumulative), display_value: null, unrounded_value: null }, hypothetical: true },
        validation: { ...(structuredClone(planValidationExample.data) as unknown as PlanValidation), workload: { '2026-27-I': { selected_credits: '0', placeholder_credits: '0', target_credits: '0' } }, completion_term: null } }),
    });
    renderScenario(s);
    const table = await screen.findByRole('table', { name: 'Baseline vs scenario (server evaluation)' }, wait);
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(`^${name}`) });
    expect(row('Completion term')).toHaveTextContent(/Completion termUnavailableUnavailable/);
    // The fixture CPI has no display value (no rounding policy): Unavailable, never 0.
    expect(row('CPI \\(server\\)')).toHaveTextContent('Unavailable');
    expect(row('CPI \\(server\\)')).not.toHaveTextContent(/\b0\b/);
    // A workload the server reports as 0 is shown as 0.
    expect(row('Workload')).toHaveTextContent('2026–27 Semester I: 0');
  });

  it('awards no credit for choosing a duration: zero from the server and an explicit statement', async () => {
    const s = server();
    renderScenario(s);
    const radios = await screen.findByRole('group', { name: 'Internship duration' }, wait);
    expect(within(radios).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['No internship', '3 months', '6 months']);
    await userEvent.click(within(radios).getByRole('radio', { name: '3 months' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-05-01' } });
    fireEvent.change(screen.getByLabelText('Last day (inclusive)'), { target: { value: '2027-07-31' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    // Only the choice and dates are sent: no credits and no modules invented for the duration.
    expect(s.patches[0]!.internship).toEqual({ duration_choice: 'three_months', preset: 'custom', placement_mode: 'unknown', start_date: '2027-05-01', end_date_exclusive: '2027-08-01', modules: [] });
    const credit = await screen.findByRole('region', { name: 'Proposed academic credit' }, wait);
    expect(credit).toHaveTextContent('Choosing a duration awards no credit.');
    const facts = within(credit).getByRole('group', { name: 'Exposure credits' });
    expect(facts).toHaveTextContent('Proposed (pending approval)0');
    expect(facts).toHaveTextContent('Approved (not yet earned)0');
    expect(facts).toHaveTextContent('Earned0');
    expect(credit).toHaveTextContent('No IN 498 modules: the internship earns no academic credit by itself.');
    const cases = screen.getByRole('table', { name: 'Internship cases on the same baseline (server)' });
    expect(within(cases).getByRole('row', { name: /^Earned credits/ })).toHaveTextContent('Earned credits0');
  });

  it('labels proposed modules "proposed, pending approval", never earned', async () => {
    const s = server({ scenario: { internship: { duration_choice: 'six_months', preset: 'custom', start_date: '2027-07-01', end_date_exclusive: '2028-01-01', placement_mode: 'onsite_full_time', modules: [] } } });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('button', { name: /Use example split: 12 open elective \+ 4 HSS \(proposed, pending approval\)/ }, wait));
    const modules = screen.getByRole('list', { name: 'IN 498 modules' });
    expect(within(modules).getAllByRole('group')).toHaveLength(4);
    expect(within(modules).getByLabelText('Target basket for IN 498 module 4')).toHaveValue('hss');
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    const sent = s.patches[0]!.internship!.modules!;
    expect(sent.map((m) => [m.credits, m.intended_allocation, m.status])).toEqual([
      ['4', 'open_elective', 'proposed'],
      ['4', 'open_elective', 'proposed'],
      ['4', 'open_elective', 'proposed'],
      ['4', 'hss', 'proposed'],
    ]);
    expect(sent.every((m) => !('approval_status' in m))).toBe(true);
    const states = await screen.findByRole('list', { name: 'Module approval states' }, wait);
    expect(within(states).getAllByText('Proposed, pending approval')).toHaveLength(4);
    expect(within(states).queryByText(/^Earned$/)).not.toBeInTheDocument();
    const credit = screen.getByRole('region', { name: 'Proposed academic credit' });
    expect(within(credit).getByRole('group', { name: 'Exposure credits' })).toHaveTextContent('Proposed (pending approval)16');
    expect(within(credit).getByRole('group', { name: 'Exposure credits' })).toHaveTextContent('Earned0');
    expect(credit).toHaveTextContent('INTERNSHIP_APPROVAL_REQUIRED');
  });

  it('renders an unrecognised module state and issue code generically', async () => {
    const s = server({
      scenario: { internship: { duration_choice: 'six_months', preset: 'custom', start_date: '2027-07-01', end_date_exclusive: '2028-01-01', placement_mode: 'onsite_full_time', modules: [{ id: 'm1', credits: '4', intended_allocation: 'robotics', status: 'completed', grade: 'F' }] } },
      scenarioEval: () => ({
        internship: { ...exampleCase('six_months'), modules: [{ id: 'm1', intended_allocation: 'robotics', status: 'failed', reasons: [] }, { id: 'm2', intended_allocation: 'hss', status: 'withdrawn', reasons: [] }], issues: [issue('INTERNSHIP_TARGET_UNKNOWN', 'error', ['m1'], 'Unknown target bucket.')] },
      }),
    });
    renderScenario(s);
    const states = await screen.findByRole('list', { name: 'Module approval states' }, wait);
    expect(states).toHaveTextContent('Unrecognised basket (robotics)');
    expect(states).toHaveTextContent('Failed');
    expect(states).toHaveTextContent('Unrecognised state (withdrawn)');
    expect(screen.getByRole('region', { name: 'Proposed academic credit' })).toHaveTextContent('INTERNSHIP_TARGET_UNKNOWN');
  });

  it('converts the inclusive last day to an end-exclusive date once, and back for display', async () => {
    const s = server({ scenario: { internship: { duration_choice: 'six_months', preset: 'custom', start_date: '2027-07-01', end_date_exclusive: '2028-01-01', placement_mode: 'onsite_full_time', modules: [] } } });
    renderScenario(s);
    expect(await screen.findByLabelText('Last day (inclusive)', {}, wait)).toHaveValue('2027-12-31');
    fireEvent.change(screen.getByLabelText('Last day (inclusive)'), { target: { value: '2028-02-29' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches[0]?.internship?.end_date_exclusive).toBe('2028-03-01'));
    expect(screen.getByLabelText('Last day (inclusive)')).toHaveValue('2028-02-29');
  });

  it('explains dates that differ from the chosen duration using the server values', async () => {
    const s = server({
      scenario: { internship: { duration_choice: 'three_months', preset: 'custom', start_date: '2027-05-01', end_date_exclusive: '2027-08-02', placement_mode: 'onsite_full_time', modules: [] } },
      scenarioEval: () => ({ internship: { ...exampleCase('three_months'), end_date_exclusive: '2027-08-02', actual_days: 93, issues: [issue('INTERNSHIP_DURATION_DIFFERS', 'warning', [], 'These dates span 93 days, not 3 calendar months.')] } }),
    });
    renderScenario(s);
    const time = await screen.findByRole('region', { name: 'Time away / course conflicts' }, wait);
    expect(time).toHaveTextContent('Actual duration (server)93 days');
    expect(time).toHaveTextContent(/These dates do not match 3 months: .* would end on 31 Jul 2027 \(last day\)/);
    expect(time).toHaveTextContent('2026–27 Summer: 61 days away');
  });

  it('asks for exact dates when the server supplies no calendar for a preset', async () => {
    const s = server();
    renderScenario(s);
    await userEvent.click(await screen.findByRole('radio', { name: '6 months' }, wait));
    await userEvent.click(screen.getByRole('radio', { name: 'Summer' }));
    expect(screen.getByRole('note')).toHaveTextContent(/has not supplied academic calendar dates \(GAP-03\).*Enter the exact start date and last day/);
    expect(screen.getByLabelText('Start date')).toHaveValue('');
    expect(screen.getByLabelText('Last day (inclusive)')).toHaveValue('');
  });

  it('apply lists exactly the plan edits and the hypothetical changes, sends both revisions and states the record is unchanged', async () => {
    const s = server({ scenario: { revision: 4, changes: [{ op: 'drop', item_id: 'c-os' }, { op: 'grade', item_id: 'c-net', grade: 'B' }], internship: { duration_choice: 'none' } } });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario (server evaluation)' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply plan edits' });
    expect(within(dialog).getByRole('list', { name: 'Plan edits to write' })).toHaveTextContent(/^Drop ZZ 330 \(2026–27 Semester I\)$/);
    const notApplied = within(dialog).getByRole('list', { name: 'Not applied' });
    expect(within(notApplied).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Hypothetical grade B for ZZ 331 (2026–27 Semester II)', 'Internship choice: No internship']);
    expect(dialog).toHaveTextContent('Your accepted record is never changed.');
    expect(s.applies).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to plan' }));
    await waitFor(() => expect(s.applies).toEqual([{ expected_plan_revision: 2, expected_scenario_revision: 4 }]));
    const done = await screen.findByText(/Plan updated to revision 3\./, { selector: 'strong' });
    expect(done.closest('[role="status"]')).toHaveTextContent('Your accepted record was not changed.');
    // The plan cache is invalidated: the baseline plan is fetched again.
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'GET' && c.path === '/plans/plan-1').length).toBeGreaterThanOrEqual(2));
    expect(s.calls.some((c) => c.method !== 'GET' && c.path.startsWith('/record'))).toBe(false);
  });

  it('a 409 on apply for a stale scenario revision offers reload and compare, never retrying', async () => {
    const s = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }] }, applyConflict: { action: 'reload_compare', code: 'REVISION_CONFLICT' } });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario (server evaluation)' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Apply plan edits' })).getByRole('button', { name: 'Apply to plan' }));
    expect(await screen.findByText(/Not applied\./)).toBeInTheDocument();
    expect(screen.getByText(/Not applied\./).closest('[role="alert"]')).toHaveTextContent('nothing is retried automatically');
    await new Promise((r) => setTimeout(r, 300));
    expect(s.applies).toHaveLength(1);
    const before = s.compares;
    await userEvent.click(screen.getByRole('button', { name: 'Reload and compare' }));
    await waitFor(() => expect(s.compares).toBe(before + 1));
    expect(s.applies).toHaveLength(1);
  });

  it('a 409 on apply for a stale baseline offers rebase', async () => {
    const s = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }] }, applyConflict: { action: 'rebase', code: 'SCENARIO_STALE' } });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario (server evaluation)' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Apply plan edits' })).getByRole('button', { name: 'Apply to plan' }));
    expect(await screen.findByRole('button', { name: 'Rebase on current record and plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload and compare' })).not.toBeInTheDocument();
    expect(s.applies).toHaveLength(1);
  });

  it('deleting a scenario sends its revision and returns to the scenario list', async () => {
    const s = server({ scenario: { revision: 2 } });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete scenario…' }, wait));
    const dialog = screen.getByRole('dialog', { name: 'Delete scenario' });
    expect(dialog).toHaveTextContent('Your baseline plan and accepted record are not changed.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete scenario' }));
    await waitFor(() => expect(s.deletes).toEqual([{ expected_revision: 2 }]));
    expect(await screen.findByText('navigated-away')).toBeInTheDocument();
  });
});
