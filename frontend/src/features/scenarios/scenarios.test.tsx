/**
 * A09 scenarios against a fake API. Every server body comes from the shared
 * contract examples: the scenario (examples/scenario.json), its comparison
 * (scenario-comparison.json), the stale-baseline 409 (scenario-stale.json),
 * the apply result (plan-apply.json), the revision 409 (revision-conflict.json)
 * and the internship cases (internship-comparison.json). Where a test needs a
 * value the example lacks, it is re-pointed at the shared plan fixture with
 * the change spelled out. The fake PATCH refuses a change on an item the
 * saved plan no longer has, as coursepath/scenarios.py apply_changes does.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import calendarExample from '../../../../examples/calendar.json';
import internshipExample from '../../../../examples/internship-comparison.json';
import applyExample from '../../../../examples/plan-apply.json';
import conflictExample from '../../../../examples/revision-conflict.json';
import comparisonExample from '../../../../examples/scenario-comparison.json';
import staleExample from '../../../../examples/scenario-stale.json';
import scenarioExample from '../../../../examples/scenario.json';
import type { AcademicPlan, CatalogueCourse, InternshipCase, Issue, PlanValidation, Scenario, ScenarioApplyResult, ScenarioComparison, ScenarioEvaluation, ScenarioPatch } from '../../api/types';
import { analysis, plan } from '../../test/fixtures';
import { fakeApi, issue, renderApp } from '../../test/harness';
import { resetKeptScenarioDrafts, ScenarioPage } from './ScenarioPage';
import { ScenariosPage } from './ScenariosPage';

const exampleCases = internshipExample.data.cases as unknown as InternshipCase[];
const exampleCase = (duration: string) => structuredClone(exampleCases.find((c) => c.duration_choice === duration)!);

const exampleComparison = comparisonExample.data.comparisons[0] as unknown as ScenarioComparison;
const exampleValidation = () => structuredClone(exampleComparison.scenario!.validation) as PlanValidation;
const exampleApply = applyExample.data as unknown as ScenarioApplyResult;

/** examples/scenario.json re-pointed at the shared plan fixture (plan-1, revision 2, items c-os and c-net). */
const baseScenario: Scenario = {
  ...(structuredClone(scenarioExample.data) as unknown as Scenario),
  id: 'sc-1',
  plan_id: plan.id,
  label: 'Lighter third year',
  baseline_record_revision: 3,
  baseline_plan_revision: plan.revision,
  rule_version: 'cse-2024-v1',
  changes: [],
};

interface ServerOptions {
  scenario?: Partial<Scenario>;
  stale?: boolean;
  conflictPatch?: boolean;
  applyConflict?: 'reload_compare' | 'rebase';
  /** DELETE answers 409 this many times first. */
  deleteConflicts?: number;
  /** The saved plan the server holds now (default: the fixture plan). */
  currentPlan?: AcademicPlan;
  /** Override the scenario evaluation the fake compare returns. */
  scenarioEval?: (s: Scenario) => Partial<ScenarioEvaluation>;
  plans?: AcademicPlan[];
  /** DELETE answers 404 (the scenario is already gone). */
  deleteNotFound?: boolean;
  /** DELETE fails like a lost connection this many times first. */
  deleteOffline?: number;
  /** PATCH fails like a lost connection this many times first. */
  patchOffline?: number;
  /** PATCH answers 404 (the scenario was deleted elsewhere). */
  patchNotFound?: boolean;
  /** What GET /calendar answers; by default no ready-made internship dates. */
  calendar?: { terms: { id: string }[]; internship_presets: unknown[] };
  /** The catalogue (titles for the planned-course search, courses for the replacement picker); by default there is none. */
  catalogue?: CatalogueCourse[];
  /** The course codes each semester's timetable offers, for the replacement picker. */
  offered?: Record<string, string[]>;
}

beforeEach(() => resetKeptScenarioDrafts());

function server(opts: ServerOptions = {}) {
  let current: Scenario = { ...structuredClone(baseScenario), ...opts.scenario };
  let stale = opts.stale ?? false;
  // A stale baseline means the saved plan moved on (revision 3) after the scenario was made at revision 2.
  let savedPlan: AcademicPlan = structuredClone(opts.currentPlan ?? (stale ? { ...plan, revision: plan.revision + 1 } : plan));
  let deleteConflicts = opts.deleteConflicts ?? 0;
  let deleteOffline = opts.deleteOffline ?? 0;
  let patchOffline = opts.patchOffline ?? 0;
  let gone = false;
  const revisionConflict = (revision: number) => ({ status: 409, data: { ...conflictExample.data, current_revision: revision }, issues: conflictExample.issues as Issue[] });
  const patches: ScenarioPatch[] = [];
  const applies: unknown[] = [];
  const creates: unknown[] = [];
  const deletes: unknown[] = [];
  let compares = 0;
  const ids = (p: AcademicPlan) => new Set(p.semesters.flatMap((x) => x.courses.map((c) => c.id)));
  // Same top-level fields as examples/scenario-comparison.json, re-pointed at this scenario and baseline.
  const comparison = (s: Scenario): ScenarioComparison => {
    const head = { ...structuredClone(exampleComparison), scenario_id: s.id, baseline_record_revision: 3, baseline_plan_revision: savedPlan.revision, rule_version: 'cse-2024-v1' };
    if (stale) {
      // The server's stale comparison (coursepath/scenarios.py compare_scenario) with the stale example's issue.
      return { ...head, stale: true, baseline: null, scenario: null, deltas: null, issues: (staleExample.issues as Issue[]).map((i) => ({ ...i, entity_refs: [s.id] })) };
    }
    const evaluated = structuredClone(exampleComparison.scenario!) as ScenarioEvaluation;
    return {
      ...head,
      stale: false,
      scenario: {
        ...evaluated,
        internship: s.internship ? { ...exampleCase(s.internship.duration_choice), modules: (s.internship.modules ?? []).map((m) => ({ id: m.id, intended_allocation: m.intended_allocation, status: 'proposed', reasons: [] })) } : null,
        ...opts.scenarioEval?.(s),
      },
    };
  };
  const api = fakeApi({
    ...(opts.catalogue ? { 'GET /catalogue': () => ({ data: { courses: opts.catalogue, coverage: 'partial', review_status: 'reviewed' } }) } : {}),
    ...Object.fromEntries(
      Object.entries(opts.offered ?? {}).map(([term, codes]) => [
        `GET /offerings?term_id=${term}`,
        () => ({ data: { id: `snap-${term}`, term_id: term, coverage: 'complete', review_status: 'reviewed', offerings: codes.map((code) => ({ id: `${term}:${code}`, code, meeting_groups: [] })) } }),
      ]),
    ),
    'GET /plans': () => ({ data: opts.plans ?? [plan] }),
    'GET /calendar': () => ({ data: opts.calendar ?? { terms: [], internship_presets: [] } }),
    'GET /plans/:id': () => ({ data: savedPlan }),
    'GET /scenarios': () => ({ data: { scenarios: gone ? [] : [current] } }),
    'POST /scenarios': (req) => {
      creates.push(req.body);
      return { status: 201, data: { ...baseScenario, id: 'sc-new', ...(req.body as object) } };
    },
    'GET /scenarios/:id': () => ({ data: current }),
    'PATCH /scenarios/:id': (req) => {
      const body = req.body as ScenarioPatch;
      patches.push(body);
      if (patchOffline > 0) {
        patchOffline -= 1;
        throw new TypeError('Failed to fetch');
      }
      if (opts.patchNotFound) return { status: 404, issues: [issue('NOT_FOUND', 'error', [], 'Not found')] };
      if (opts.conflictPatch || body.expected_revision !== current.revision) return revisionConflict(current.revision + 3);
      const { expected_revision: _expected, rebase, ...rest } = body;
      const changes = rest.changes ?? current.changes;
      const known = ids(savedPlan);
      const unknown = changes.find((c) => c.op !== 'cap' && !known.has(c.item_id));
      if (unknown && unknown.op !== 'cap') return { status: 400, issues: [issue('INVALID_INPUT', 'error', [], `Unknown planned item ${unknown.item_id}`)] };
      current = { ...current, ...rest, revision: current.revision + 1, ...(rebase ? { baseline_plan_revision: savedPlan.revision } : {}) };
      if (rebase) stale = false;
      return { data: current };
    },
    'DELETE /scenarios/:id': (req) => {
      deletes.push(req.body);
      if (deleteOffline > 0) {
        deleteOffline -= 1;
        throw new TypeError('Failed to fetch');
      }
      if (opts.deleteNotFound) return { status: 404, issues: [issue('NOT_FOUND', 'error', [], 'Not found')] };
      if (deleteConflicts > 0) {
        deleteConflicts -= 1;
        current = { ...current, revision: current.revision + 1 };
        return revisionConflict(current.revision);
      }
      gone = true;
      return { data: null };
    },
    'POST /scenarios/compare': () => {
      compares += 1;
      const cases = current.internship && !stale ? [{ ...exampleCase(current.internship.duration_choice), scenario_id: current.id }] : [];
      return { data: { comparisons: [comparison(current)], internship_cases: cases }, issues: comparison(current).issues };
    },
    'POST /scenarios/:id/apply-plan': (req) => {
      applies.push(req.body);
      if (opts.applyConflict === 'rebase') return { status: 409, data: staleExample.data, issues: staleExample.issues as Issue[] };
      if (opts.applyConflict === 'reload_compare') return revisionConflict(3);
      // The server writes the drops to the saved plan (postpone and replace are not used by these tests); the baseline is then stale.
      const dropped = new Set(current.changes.filter((c) => c.op === 'drop').map((c) => (c as { item_id: string }).item_id));
      savedPlan = { ...savedPlan, revision: savedPlan.revision + 1, semesters: savedPlan.semesters.map((x) => ({ ...x, courses: x.courses.filter((c) => !dropped.has(c.id)) })) };
      stale = true;
      // examples/plan-apply.json with its plan re-pointed at the fixture plan.
      // what the server leaves in the scenario: the changes that never reach a plan (coursepath/scenarios.py PLAN_OPS), each with its own reason
      const notApplied = current.changes.filter((c) => !['drop', 'postpone', 'replace'].includes(c.op)).map((c) => ({ op: c.op, item_id: 'item_id' in c ? c.item_id : null, term_id: 'term_id' in c ? c.term_id : null, reason: 'Hypothetical grades, failures and caps never enter a saved plan or the record.' }));
      return { data: { ...structuredClone(exampleApply), not_applied: notApplied, plan: { ...exampleApply.plan, ...savedPlan, validation: exampleValidation() } } };
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

/** Choose a planned course the way a student does: type part of it in the search box, then pick the match. */
async function planned(form: HTMLElement, search: string, name: RegExp) {
  await userEvent.type(within(form).getByLabelText('Planned course'), search);
  await userEvent.click(within(form).getByRole('option', { name }));
}

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
    // Revision numbers and rule versions are developer detail: the banner names the plan only.
    expect(banner).toHaveTextContent('Based on plan');
    expect(banner).not.toHaveTextContent(/revision|Rules|server/i);
    expect(within(banner).getByRole('link', { name: 'Return to baseline' })).toHaveAttribute('href', '/plan/plan-1');
  });

  it('says what a what-if is: its name, and that the record and plans stay unchanged until it is applied', async () => {
    const s = server();
    renderScenario(s);
    const banner = await screen.findByRole('region', { name: 'Scenario (hypothetical)' }, wait);
    expect(banner).toHaveTextContent('What-if: Lighter third year. Your record and plans stay unchanged until you apply it.');
    expect(banner).toHaveClass('scenario-banner');
  });

  it('shows each change as a chip that carries its type, in words and without internal ids', async () => {
    const s = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }, { op: 'grade', item_id: 'c-net', grade: 'B' }, { op: 'cap', term_id: '2026-27-II', credits: '20' }] } });
    renderScenario(s);
    const changes = await screen.findByRole('list', { name: 'Hypothetical changes' }, wait);
    const chips = within(changes).getAllByRole('listitem');
    expect(chips.map((li) => li.getAttribute('data-op'))).toEqual(['drop', 'grade', 'cap']);
    chips.forEach((li) => expect(li).toHaveClass('change-chip'));
    expect(changes).not.toHaveTextContent(/c-os|c-net|op/);
  });

  it('shows what the scenario changes as a diff above the comparison table, built from the scenario and the server comparison', async () => {
    const s = server({ scenario: { changes: [{ op: 'postpone', item_id: 'c-os', term_id: '2027-28-I' }] } });
    renderScenario(s);
    const diff = await screen.findByRole('group', { name: 'Changes in Lighter third year compared with your plan' }, wait);
    const lines = Array.from(diff.querySelectorAll('.diff-line')).map((el) => el.textContent);
    expect(lines).toContain('@@ your plan → what-if: Lighter third year @@');
    expect(lines).toContain('- 2026–27 Semester I   ZZ 330   4');
    expect(lines).toContain('+ 2027–28 Semester I   ZZ 330   4');
    // every marked line is either "-" or "+", and the diff sits before the table
    expect(lines.filter((l) => l && !l.startsWith('@@')).every((l) => /^[-+] /.test(l ?? ''))).toBe(true);
    const table = screen.getByRole('table', { name: 'Baseline vs scenario' });
    expect(diff.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds typed changes, lists them exactly and saves them with the expected revision', async () => {
    const s = server();
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330 · 2026–27 Semester I/ }, wait);
    await addChange('postpone', async (f) => {
      await planned(f, 'zz331', /ZZ 331/);
      await userEvent.selectOptions(within(f).getByLabelText('Later term'), '2027-28-I');
    });
    await addChange('grade', async (f) => {
      await planned(f, 'zz331', /ZZ 331/);
      await userEvent.selectOptions(within(f).getByLabelText('Hypothetical letter grade'), 'B');
    });
    // A replacement with no course chosen is refused with a specific message; nothing is added.
    await addChange('replace', async (f) => {
      await planned(f, 'zz330', /ZZ 330/);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a replacement course.');
    const form = screen.getByRole('form', { name: 'Add a hypothetical change' });
    // A replacement with an invalid code is refused by the picker with its own message.
    await userEvent.type(within(form).getByLabelText('Course code'), '???');
    await userEvent.type(within(form).getByLabelText('Credits'), '4');
    await userEvent.click(within(form).getByRole('button', { name: 'Use this course' }));
    expect(within(within(form).getByRole('form', { name: 'Add a course by code' })).getByRole('alert')).toHaveTextContent('Enter a course code such as "CS 330"');
    await userEvent.clear(within(form).getByLabelText('Course code'));
    await userEvent.type(within(form).getByLabelText('Course code'), 'zz332');
    await userEvent.click(within(form).getByRole('button', { name: 'Use this course' }));
    expect(within(form).getByRole('group', { name: 'Replacement course' })).toHaveTextContent('ZZ 332 · 4 credits');
    await userEvent.click(within(form).getByRole('button', { name: 'Add change' }));
    await addChange('drop', async (f) => planned(f, 'zz330', /ZZ 330/));
    await addChange('cap', async (f) => {
      await userEvent.selectOptions(within(f).getByLabelText('Term to cap'), '2026-27-II');
      await userEvent.type(within(f).getByLabelText('Credit cap'), '16');
    });
    const listed = screen.getByRole('list', { name: 'Hypothetical changes' });
    expect(within(listed).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual([
      'Postpone ZZ 331 (2026–27 Semester II) to 2027–28 Semester I',
      'Hypothetical grade B for ZZ 331 (2026–27 Semester II)',
      'Replace ZZ 330 (2026–27 Semester I) with ZZ 332 (4 credits)',
      'Drop ZZ 330 (2026–27 Semester I)',
      'Cap 2026–27 Semester II at 16 credits',
    ]);
    expect(listed).not.toHaveTextContent('The server will refuse this change');
    expect(screen.getByRole('status', { name: 'Scenario save status' })).toHaveTextContent('Unsaved changes');
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    expect(s.patches[0]).toEqual({
      expected_revision: 0,
      label: 'Lighter third year',
      internship: null,
      changes: [
        { op: 'postpone', item_id: 'c-net', term_id: '2027-28-I' },
        { op: 'grade', item_id: 'c-net', grade: 'B' },
        { op: 'replace', item_id: 'c-os', course: { normalized_code: 'ZZ 332', credits: '4' } },
        { op: 'drop', item_id: 'c-os' },
        { op: 'cap', term_id: '2026-27-II', credits: '16' },
      ],
    });
    expect(await screen.findByRole('status', { name: 'Scenario save status' })).toHaveTextContent('Saved');
  });

  it('shows the conflict panel on a 409 save and never retries automatically', async () => {
    const s = server({ conflictPatch: true });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await addChange('fail', async (f) => planned(f, 'zz330', /ZZ 330/));
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    const panel = (await screen.findByText(/This was saved elsewhere/)).closest('[role="alert"]');
    expect(panel).not.toHaveTextContent(/revision/i);
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
  });

  it('shows a re-evaluating state while the comparison is out of date', async () => {
    const s = server();
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    await addChange('drop', async (f) => planned(f, 'zz330', /ZZ 330/));
    expect(screen.getByText(/You have unsaved changes\. The results below are for the saved version/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Baseline vs scenario' }).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows Unavailable for missing server values and keeps a real 0 as 0', async () => {
    const s = server({
      scenario: { internship: { duration_choice: 'three_months', preset: 'custom', start_date: '2027-05-01', end_date_exclusive: '2027-08-01', placement_mode: 'onsite_full_time', modules: [] } },
      scenarioEval: () => ({
        performance: { ...structuredClone(analysis.performance), cumulative: { ...structuredClone(analysis.performance.cumulative), display_value: null, unrounded_value: null }, hypothetical: true },
        validation: { ...exampleValidation(), workload: { '2026-27-I': { selected_credits: '0', placeholder_credits: '0', target_credits: '0' } }, completion_term: null } }),
    });
    renderScenario(s);
    const table = await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(`^${name}`) });
    expect(row('Completion term')).toHaveTextContent(/Completion term——/);
    // The fixture CPI has no display value (no rounding policy): a dash, never 0.
    expect(row('CPI')).toHaveTextContent('—');
    expect(row('CPI')).not.toHaveTextContent(/\b0\b/);
    // A workload the server reports as 0 is shown as 0.
    expect(row('Credits per term')).toHaveTextContent('2026–27 Semester I: 0');
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
    const cases = screen.getByRole('table', { name: 'Internship cases on the same baseline' });
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
    expect(credit).not.toHaveTextContent('INTERNSHIP_APPROVAL_REQUIRED');   // issue codes are not shown
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
    expect(screen.getByRole('region', { name: 'Proposed academic credit' })).toHaveTextContent('Unknown target bucket.');
    expect(screen.getByRole('region', { name: 'Proposed academic credit' })).not.toHaveTextContent('INTERNSHIP_TARGET_UNKNOWN');
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
    expect(time).toHaveTextContent('Actual duration93 days');
    expect(time).toHaveTextContent(/These dates do not match 3 months: .* would end on 31 Jul 2027 \(last day\)/);
    expect(time).toHaveTextContent('2026–27 Summer: 61 days away');
  });

  it('asks for exact dates when the server supplies no calendar for a preset', async () => {
    const s = server();
    renderScenario(s);
    await userEvent.click(await screen.findByRole('radio', { name: '6 months' }, wait));
    await userEvent.click(screen.getByRole('radio', { name: 'Summer' }));
    // The wording changed with the ready-made periods (the old text said "Dates for this period are not available yet").
    expect(screen.getByRole('note')).toHaveTextContent(/There are no ready-made dates for 6 months.*enter the exact start date and last day/);
    expect(screen.getByLabelText('Start date')).toHaveValue('');
    expect(screen.getByLabelText('Last day (inclusive)')).toHaveValue('');
  });

  it('a ready-made period from the calendar fills both dates, and the save sends them', async () => {
    const s = server({ calendar: calendarExample.data as never });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('radio', { name: '6 months' }, wait));
    await userEvent.click(screen.getByRole('radio', { name: 'Summer' }));
    // examples/calendar.json: six months from 1 May 2027 ends before 1 Nov 2027, so the last day is 31 Oct 2027
    await userEvent.click(await screen.findByRole('radio', { name: 'Summer 2027: 1 May 2027 to 31 Oct 2027' }));
    expect(screen.getByLabelText('Start date')).toHaveValue('2027-05-01');
    expect(screen.getByLabelText('Last day (inclusive)')).toHaveValue('2027-10-31');
    expect(screen.queryByRole('radio', { name: /Summer 2027: 1 May 2027 to 31 Jul 2027/ })).not.toBeInTheDocument(); // the 3-month period is not offered for 6 months
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches[0]?.internship).toMatchObject({ duration_choice: 'six_months', preset: 'summer', start_date: '2027-05-01', end_date_exclusive: '2027-11-01' }));
  });

  it('switching the duration drops ready-made dates that belong to the other duration', async () => {
    const s = server({ calendar: calendarExample.data as never });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('radio', { name: '6 months' }, wait));
    await userEvent.click(screen.getByRole('radio', { name: 'Summer' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Summer 2027: 1 May 2027 to 31 Oct 2027/ }));
    await userEvent.click(screen.getByRole('radio', { name: '3 months' }));
    expect(screen.getByLabelText('Start date')).toHaveValue('');
    expect(screen.getByLabelText('Last day (inclusive)')).toHaveValue('');
  });

  it('apply lists exactly the plan edits and the hypothetical changes, sends both revisions and states the record is unchanged', async () => {
    const s = server({ scenario: { revision: 4, changes: [{ op: 'drop', item_id: 'c-os' }, { op: 'grade', item_id: 'c-net', grade: 'B' }], internship: { duration_choice: 'none' } } });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply plan edits' });
    expect(within(dialog).getByRole('list', { name: 'Plan edits to write' })).toHaveTextContent(/^Drop ZZ 330 \(2026–27 Semester I\)$/);
    const notApplied = within(dialog).getByRole('list', { name: 'Not applied' });
    expect(within(notApplied).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Hypothetical grade B for ZZ 331 (2026–27 Semester II)', 'Internship choice: No internship']);
    expect(dialog).toHaveTextContent('Your record is never changed.');
    expect(s.applies).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to plan' }));
    await waitFor(() => expect(s.applies).toEqual([{ expected_plan_revision: 2, expected_scenario_revision: 4 }]));
    const done = await screen.findByText(/Plan updated\./, { selector: 'strong' });
    expect(done.closest('[role="status"]')).toHaveTextContent('Your record was not changed.');
    // The plan cache is invalidated: the baseline plan is fetched again.
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'GET' && c.path === '/plans/plan-1').length).toBeGreaterThanOrEqual(2));
    expect(s.calls.some((c) => c.method !== 'GET' && c.path.startsWith('/record'))).toBe(false);
  });

  it('a 409 on apply for a stale scenario revision offers reload and compare, never retrying', async () => {
    const s = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }] }, applyConflict: 'reload_compare' });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Apply plan edits' })).getByRole('button', { name: 'Apply to plan' }));
    expect(await screen.findByText(/Not applied\./)).toBeInTheDocument();
    const refused = screen.getByText(/Not applied\./).closest('[role="alert"]')!;
    expect(refused).toHaveTextContent('nothing is retried automatically');
    // The server message (examples/revision-conflict.json) already ends in a full stop; it is not doubled.
    expect(refused).toHaveTextContent('Not applied. Another device saved a newer revision. Nothing was changed');
    await new Promise((r) => setTimeout(r, 300));
    expect(s.applies).toHaveLength(1);
    const before = s.compares;
    await userEvent.click(screen.getByRole('button', { name: 'Reload and compare' }));
    await waitFor(() => expect(s.compares).toBe(before + 1));
    expect(s.applies).toHaveLength(1);
  });

  it('a 409 on apply for a stale baseline offers rebase', async () => {
    const s = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }] }, applyConflict: 'rebase' });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Apply plan edits' })).getByRole('button', { name: 'Apply to plan' }));
    expect(await screen.findByRole('button', { name: 'Rebase on current record and plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload and compare' })).not.toBeInTheDocument();
    // examples/scenario-stale.json's message ends in a full stop and has no current_revision: one full stop, not two.
    const refused = screen.getByText(/Not applied\./).closest('[role="alert"]')!;
    expect(refused).toHaveTextContent('after this scenario was created. Nothing was changed');
    expect(refused.textContent).not.toMatch(/\.\./);
    expect(s.applies).toHaveLength(1);
  });

  it('offers only changes the server accepts after the earlier ones, and says why a loaded one would be refused', async () => {
    // coursepath/scenarios.py apply_changes: a dropped or graded course takes no further changes; a postpone must move later.
    const s = server({ scenario: { changes: [{ op: 'grade', item_id: 'c-net', grade: 'B' }, { op: 'postpone', item_id: 'c-net', term_id: '2027-28-I' }] } });
    renderScenario(s);
    const listed = await screen.findByRole('list', { name: 'Hypothetical changes' }, wait);
    await waitFor(() => expect(within(listed).getAllByRole('listitem')[1]).toHaveTextContent('This change cannot be saved'));
    expect(within(listed).getAllByRole('listitem')[0]).not.toHaveTextContent('This change cannot be saved');
    expect(within(listed).getAllByRole('listitem')[1]).toHaveTextContent('takes no further changes');
    const form = screen.getByRole('form', { name: 'Add a hypothetical change' });
    // The graded course is not offered again; the other one is.
    const course = within(form).getByRole('listbox', { name: 'Planned courses' });
    expect(within(course).queryByRole('option', { name: /ZZ 331/ })).not.toBeInTheDocument();
    expect(within(course).getByRole('option', { name: /ZZ 330/ })).toBeInTheDocument();
    // A drop removes the course from the choices too.
    await addChange('drop', async (f) => planned(f, 'zz330', /ZZ 330/));
    expect(within(form).queryByRole('option', { name: /ZZ 330/ })).not.toBeInTheDocument();
  });

  it('a postpone offers only terms after where earlier changes left the course', async () => {
    const s = server({ scenario: { changes: [{ op: 'postpone', item_id: 'c-net', term_id: '2027-28-I' }] } });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 331 · 2027–28 Semester I/ }, wait);
    const form = screen.getByRole('form', { name: 'Add a hypothetical change' });
    await userEvent.selectOptions(within(form).getByLabelText('Change type'), 'postpone');
    await planned(form, 'zz331', /ZZ 331/);
    const later = within(within(form).getByLabelText('Later term')).getAllByRole('option').map((o) => o.getAttribute('value')).filter(Boolean);
    expect(later).not.toContain('2027-28-I');
    expect(later).not.toContain('2026-27-II');
    expect(later[0]).toBe('2027-28-II');
  });

  it('rebase after "Apply to plan" leaves out the applied plan edits and keeps the hypothetical ones', async () => {
    const s = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }, { op: 'grade', item_id: 'c-net', grade: 'B' }] } });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Apply plan edits' })).getByRole('button', { name: 'Apply to plan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rebase on current record and plan' }, wait));
    await waitFor(() => expect(s.patches).toEqual([{ expected_revision: 0, rebase: true, changes: [{ op: 'grade', item_id: 'c-net', grade: 'B' }] }]));
    await waitFor(() => expect(screen.queryByText(/The baseline changed\./)).not.toBeInTheDocument());
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Hypothetical changes' })).not.toHaveTextContent('Drop');
  });

  it('rebase names the changes that no longer match the saved plan and leaves them out only when asked', async () => {
    // The saved plan dropped ZZ 330 elsewhere; the scenario still drops it and grades ZZ 331.
    const moved: AcademicPlan = { ...structuredClone(plan), revision: 3, semesters: plan.semesters.map((x) => ({ ...x, courses: x.courses.filter((c) => c.id !== 'c-os') })) };
    const s = server({ stale: true, currentPlan: moved, scenario: { changes: [{ op: 'drop', item_id: 'c-os' }, { op: 'grade', item_id: 'c-net', grade: 'B' }] } });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Rebase on current record and plan' }, wait));
    const named = await screen.findByRole('alert', { name: 'Changes that no longer match the plan' });
    expect(named).toHaveTextContent(/Drop a course that is no longer in the plan: This course is not in the plan/); // the plan no longer has it, so no internal id is shown
    expect(named).not.toHaveTextContent('c-os');
    expect(named).not.toHaveTextContent('Hypothetical grade');
    expect(s.patches).toHaveLength(0);
    await userEvent.click(within(named).getByRole('button', { name: 'Rebase without these changes' }));
    await waitFor(() => expect(s.patches).toEqual([{ expected_revision: 0, rebase: true, changes: [{ op: 'grade', item_id: 'c-net', grade: 'B' }] }]));
    await waitFor(() => expect(screen.queryByRole('alert', { name: 'Changes that no longer match the plan' })).not.toBeInTheDocument());
    expect(screen.queryByText(/The baseline changed\./)).not.toBeInTheDocument();
  });

  it('"Keep my version" after a 409 on delete deletes over the newer revision and never PATCHes', async () => {
    const s = server({ scenario: { revision: 2 }, deleteConflicts: 1 });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete scenario…' }, wait));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete scenario' })).getByRole('button', { name: 'Delete scenario' }));
    const panel = (await screen.findByText(/This was saved elsewhere/)).closest('[role="alert"]') as HTMLElement;
    expect(panel).toHaveTextContent('Delete this scenario.');
    expect(s.deletes).toEqual([{ expected_revision: 2 }]);
    await userEvent.click(within(panel).getByRole('button', { name: 'Keep my version' }));
    await waitFor(() => expect(s.deletes).toEqual([{ expected_revision: 2 }, { expected_revision: 3 }]));
    expect(s.patches).toHaveLength(0);
    expect(await screen.findByText('navigated-away')).toBeInTheDocument();
  });

  it('shows an unknown exam overlap as unknown, not as no overlap', async () => {
    // Derived from examples/internship-comparison.json: the server has no exam dates for the overlapping term (exam_overlap null).
    const unknownExams = (): InternshipCase => {
      const c = exampleCase('three_months');
      c.overlapping_terms = c.overlapping_terms.map((t) => ({ ...t, exam_overlap: null }));
      return c;
    };
    const s = server({
      scenario: { internship: { duration_choice: 'three_months', preset: 'custom', start_date: '2027-05-01', end_date_exclusive: '2027-08-01', placement_mode: 'onsite_full_time', modules: [] } },
      scenarioEval: () => ({ internship: unknownExams() }),
    });
    renderScenario(s);
    const time = await screen.findByRole('region', { name: 'Time away / course conflicts' }, wait);
    expect(time).toHaveTextContent('exam overlap unknown');
    expect(time).not.toHaveTextContent('including exams');
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

// ---- Scenario page bugs reported 8 Nov: saving, deleting, repeated preparation problems.

import { render } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiClient } from '../../api/client';
import { ResourceCacheProvider } from '../../api/resources';
import { SessionProvider } from '../../app/session';
import { ViewContextProvider } from '../../app/viewContext';

/** The scenario page and a second page in one app with one shared cache, so a test can leave the scenario and come back to it. */
function renderWithAway(s: ReturnType<typeof server>) {
  return render(
    <MemoryRouter initialEntries={['/scenarios/sc-1']}>
      <ResourceCacheProvider>
        <SessionProvider createClient={(onAuthExpired) => new ApiClient({ fetch: s.fetchImpl, onAuthExpired })}>
          <ViewContextProvider>
            <Routes>
              <Route
                path="/scenarios/:scenario_id"
                element={
                  <>
                    <Link to="/away">Away</Link>
                    <ScenarioPage />
                  </>
                }
              />
              <Route path="/away" element={<Link to="/scenarios/sc-1">Back to the scenario</Link>} />
            </Routes>
          </ViewContextProvider>
        </SessionProvider>
      </ResourceCacheProvider>
    </MemoryRouter>,
  );
}

const nameField = () => screen.getByLabelText('Scenario name');
async function rename(value: string) {
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), value);
}
const saveStatus = () => screen.getByRole('status', { name: 'Scenario save status' });

describe('scenario saving', () => {
  it('after a save, leaving and coming back starts from the newest revision, so the next save does not conflict', async () => {
    const s = server({ scenario: { revision: 2 } });
    renderWithAway(s);
    await screen.findByRole('heading', { name: 'Lighter third year' }, wait);
    await rename('First name');
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved'));
    await userEvent.click(screen.getByRole('link', { name: 'Away' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Back to the scenario' }));
    await screen.findByRole('heading', { name: 'First name' }, wait);
    await rename('Second name');
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches).toHaveLength(2));
    expect(s.patches.map((p) => p.expected_revision)).toEqual([2, 3]); // the second save carries the revision the first one produced
    expect(screen.queryByText(/This was saved elsewhere/)).not.toBeInTheDocument();
  });

  it('unsaved edits are still there when the student leaves the page and comes back', async () => {
    const s = server({ scenario: { revision: 2 } });
    renderWithAway(s);
    await screen.findByRole('heading', { name: 'Lighter third year' }, wait);
    await rename('Half-finished name');
    await userEvent.click(screen.getByRole('link', { name: 'Away' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Back to the scenario' }));
    await screen.findByRole('heading', { name: 'Lighter third year' }, wait);
    expect(nameField()).toHaveValue('Half-finished name');
    expect(saveStatus()).toHaveTextContent('Unsaved changes');
    expect(s.patches).toHaveLength(0); // nothing was sent behind the student's back
  });

  it('a double click on Save sends one save', async () => {
    const s = server({ scenario: { revision: 2 } });
    renderScenario(s);
    await screen.findByRole('heading', { name: 'Lighter third year' }, wait);
    await rename('Once');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved'));
    expect(s.patches).toHaveLength(1);
  });

  it('a lost connection keeps the edits, says so plainly, and Try again saves them', async () => {
    const s = server({ scenario: { revision: 2 }, patchOffline: 1 });
    renderScenario(s);
    await screen.findByRole('heading', { name: 'Lighter third year' }, wait);
    await rename('Offline edit');
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    const problem = await screen.findByRole('alert');
    expect(problem).toHaveTextContent('CoursePath could not be reached');
    expect(problem).toHaveTextContent('Your changes are still here');
    expect(problem).not.toHaveTextContent(/[A-Z]{3,}_[A-Z_]+/); // no error codes
    expect(nameField()).toHaveValue('Offline edit');
    await userEvent.click(within(problem).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved'));
    expect(s.patches.map((p) => p.expected_revision)).toEqual([2, 2]);
  });

  it('saving a scenario that was deleted elsewhere says it no longer exists and links to the list', async () => {
    const s = server({ scenario: { revision: 2 }, patchNotFound: true });
    renderScenario(s);
    await screen.findByRole('heading', { name: 'Lighter third year' }, wait);
    await rename('Too late');
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    const problem = await screen.findByRole('alert');
    expect(problem).toHaveTextContent('This scenario no longer exists');
    expect(within(problem).getByRole('link', { name: 'Your scenarios' })).toHaveAttribute('href', '/scenarios');
  });
});

describe('deleting a scenario', () => {
  it('the current scenario has a Delete button at the top of the page that asks first and then deletes with its revision', async () => {
    const s = server({ scenario: { revision: 2 } });
    renderScenario(s);
    const top = await screen.findByRole('button', { name: 'Delete scenario' }, wait);
    await userEvent.click(top);
    expect(s.deletes).toHaveLength(0); // never a one-click delete
    const dialog = screen.getByRole('dialog', { name: 'Delete scenario' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(s.deletes).toHaveLength(0);
    await userEvent.click(top);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete scenario' })).getByRole('button', { name: 'Delete scenario' }));
    await waitFor(() => expect(s.deletes).toEqual([{ expected_revision: 2 }]));
    expect(await screen.findByText('navigated-away')).toBeInTheDocument();
  });

  it('a scenario that is already gone is treated as deleted and the student returns to the list', async () => {
    const s = server({ scenario: { revision: 2 }, deleteNotFound: true });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete scenario' }, wait));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete scenario' })).getByRole('button', { name: 'Delete scenario' }));
    expect(await screen.findByText('navigated-away')).toBeInTheDocument();
  });

  it('a lost connection during delete says nothing was deleted, and can be tried again', async () => {
    const s = server({ scenario: { revision: 2 }, deleteOffline: 1 });
    renderScenario(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete scenario' }, wait));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete scenario' })).getByRole('button', { name: 'Delete scenario' }));
    const problem = await screen.findByRole('alert');
    expect(problem).toHaveTextContent('CoursePath could not be reached');
    await userEvent.click(screen.getByRole('button', { name: 'Delete scenario' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete scenario' })).getByRole('button', { name: 'Delete scenario' }));
    await waitFor(() => expect(s.deletes).toHaveLength(2));
    expect(await screen.findByText('navigated-away')).toBeInTheDocument();
  });

  it('the scenarios list has a Delete button per scenario that asks, deletes with the revision and removes it from the list', async () => {
    const s = server({ scenario: { revision: 2 } });
    renderApp(<ScenariosPage />, { fetchImpl: s.fetchImpl, route: '/scenarios', path: '/scenarios' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete scenario Lighter third year' }, wait));
    const dialog = screen.getByRole('dialog', { name: 'Delete this scenario?' });
    expect(dialog).toHaveTextContent('deleted for good and cannot be undone');
    expect(dialog).toHaveTextContent('Your baseline plan, your other plans and your record are not changed.');
    expect(s.deletes).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete scenario' }));
    await waitFor(() => expect(s.deletes).toEqual([{ expected_revision: 2 }]));
    expect(await screen.findByText('Deleted “Lighter third year”.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('You have no scenarios yet.')).toBeInTheDocument());
  });

  it('on the list, a scenario changed elsewhere is not deleted and the student is told to check it', async () => {
    const s = server({ scenario: { revision: 2 }, deleteConflicts: 1 });
    renderApp(<ScenariosPage />, { fetchImpl: s.fetchImpl, route: '/scenarios', path: '/scenarios' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete scenario Lighter third year' }, wait));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete this scenario?' })).getByRole('button', { name: 'Delete scenario' }));
    const note = await screen.findByRole('alert');
    expect(note).toHaveTextContent('was changed in another tab or on another device, so it was not deleted');
    expect(screen.getByRole('link', { name: 'Lighter third year' })).toBeInTheDocument();
  });
});

describe('scenario problems are shown once, in plain words', () => {
  const problem = (code: string, severity: Issue['severity'], refs: string[], message: string): Issue => issue(code, severity, refs, message);
  const repeated: Issue[] = [
    // the server reports a preparation problem per course; four courses have no recommendation (a note, hidden), two share one missing course
    ...['c-os', 'c-net', 'x-1', 'x-2'].map((id) => problem('PREREQUISITE_UNKNOWN', 'info', [id], 'No recommendation recorded for this course in the CoursePath team list. That is not a claim that it has no prerequisites.')),
    problem('PREREQUISITE_MISSING', 'warning', ['c-net'], 'Recommended preparation (CoursePath team) missing: ZZ 330'),
    problem('PREREQUISITE_MISSING', 'warning', ['c-os'], 'Recommended preparation (CoursePath team) missing: ZZ 330'),
    problem('PREREQUISITE_MISSING', 'warning', ['c-net'], 'Recommended preparation (CoursePath team) missing: ZZ 330'),
    problem('PREREQUISITE_CONDITIONAL', 'warning', ['c-os'], 'Recommended preparation (CoursePath team) is planned earlier; it helps only if passed.'),
  ];

  async function scenarioCell(rowName: string, issues: Issue[]) {
    const s = server({ scenarioEval: () => ({ issues }) });
    renderScenario(s);
    const table = await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    const row = within(table).getByRole('rowheader', { name: rowName }).closest('tr') as HTMLElement;
    return within(row).getAllByRole('cell')[1] as HTMLElement; // the scenario column
  }

  it('the same preparation problem appears once, grouped by the courses it affects', async () => {
    const cell = await scenarioCell('Recommended earlier courses', repeated);
    expect(within(cell).getAllByText(/Recommended earlier course not completed or planned: ZZ 330/)).toHaveLength(1);
    expect(cell).toHaveTextContent('Recommended earlier course not completed or planned: ZZ 330 (affects ZZ 330, ZZ 331)');
    expect(within(cell).getAllByText(/A recommended earlier course is planned first; it only helps if you pass it\./)).toHaveLength(1);
  });

  it('notes about courses with no recommendation are not listed, and no team or rule wording shows', async () => {
    const cell = await scenarioCell('Recommended earlier courses', repeated);
    expect(cell).not.toHaveTextContent(/No recommendation recorded/);
    expect(cell).not.toHaveTextContent(/CoursePath team/);
    expect(cell).not.toHaveTextContent(/PREREQUISITE_|D-\d\d/);
  });

  it('a scenario with no preparation problem says None', async () => {
    const cell = await scenarioCell('Recommended earlier courses', repeated.filter((i) => i.severity === 'info'));
    expect(cell).toHaveTextContent('None');
  });

  it('a timetable clash reported for several meetings is listed once per pair of courses', async () => {
    const clash = (meeting: string) => issue('TIMETABLE_CONFLICT', 'warning', ['c-os', 'c-net', `m-${meeting}-a`, `m-${meeting}-b`], 'Meetings may overlap. A meeting belongs to alternatives or a group whose required meetings are not stated.');
    const cell = await scenarioCell('Timetable clashes', [clash('1'), clash('2'), clash('3')]);
    expect(within(cell).getAllByText('ZZ 330 and ZZ 331 may meet at the same time. Check the sections you pick.')).toHaveLength(1);
    expect(cell).not.toHaveTextContent(/alternatives or a group/);
  });

  it('the table keeps internship rows out when no scenario has an internship', async () => {
    const s = server({ scenario: { internship: null } });
    renderScenario(s);
    const table = await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    expect(within(table).queryByRole('rowheader', { name: /Internship credits/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole('rowheader', { name: 'Terms away (internship)' })).not.toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Credits per term' })).toBeInTheDocument();
  });

  it('shows no developer wording on the scenario page: no codes, rule names, team wording or revisions', async () => {
    const s = server({ scenario: { revision: 2 }, scenarioEval: () => ({ issues: repeated }) });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/D-\d\d|[A-Z]{3,}_[A-Z_]{3,}|CoursePath team|rule set|cse-2024|revision \d|Server reasons/i);
  });
});

describe('after applying a scenario', () => {
  it('names the changes that stayed hypothetical and the dropped course in words, never as internal ids', async () => {
    const s = server({ scenario: { changes: [{ op: 'drop', item_id: 'c-os' }, { op: 'grade', item_id: 'c-net', grade: 'B' }, { op: 'cap', term_id: '2026-27-II', credits: '20' }] } });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    await userEvent.click(screen.getByRole('button', { name: 'Apply to plan…' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Apply plan edits' })).getByRole('button', { name: 'Apply to plan' }));
    const updated = await screen.findByText(/Plan updated\./, { selector: 'strong' }, wait);
    const box = updated.closest('[role="status"]') as HTMLElement;
    expect(box).toHaveTextContent('These stay in the scenario and were not written to your plan:');
    expect(box).toHaveTextContent('Hypothetical grade B for ZZ 331 (2026–27 Semester II)');
    expect(box).toHaveTextContent('Cap 2026–27 Semester II at 20 credits');
    expect(box).not.toHaveTextContent(/fail —|grade —|cap:/);
    // the dropped course left the plan, but the change list still names it
    const changes = await screen.findByRole('list', { name: 'Hypothetical changes' });
    expect(changes).toHaveTextContent('Drop ZZ 330 (2026–27 Semester I)');
    expect(changes).not.toHaveTextContent(/c-os|planned item/);
  });
});

describe('choosing the planned course to change (a search, not a plain list)', () => {
  const titled: CatalogueCourse[] = [
    { id: 'k1', normalized_code: 'ZZ 330', title: 'Operating Systems', credits: '4', baskets: [], could_satisfy: [] },
    { id: 'k2', normalized_code: 'ZZ 331', title: 'Computer Networks', credits: '4', baskets: [], could_satisfy: [] },
  ];
  const formOf = () => screen.getByRole('form', { name: 'Add a hypothetical change' });
  const searchBox = () => within(formOf()).getByRole('combobox', { name: 'Planned course' });
  const shown = () => within(within(formOf()).getByRole('listbox', { name: 'Planned courses' })).queryAllByRole('option').map((o) => o.textContent);

  it('finds a course by part of its title and shows it as code, title, semester and credits', async () => {
    const s = server({ catalogue: titled });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await userEvent.type(searchBox(), 'oper');
    expect(shown()).toEqual(['ZZ 330 · Operating Systems · 2026–27 Semester I · 4 credits']);
    await userEvent.click(within(formOf()).getByRole('option', { name: /Operating Systems/ }));
    expect(within(formOf()).getByRole('group', { name: 'Planned course' })).toHaveTextContent('ZZ 330 · Operating Systems · 2026–27 Semester I · 4 credits');
    await userEvent.click(within(formOf()).getByRole('button', { name: 'Add change' }));
    // The change names the planned item the student chose, and saving sends that item's id.
    expect(within(screen.getByRole('list', { name: 'Hypothetical changes' })).getByText('Drop ZZ 330 (2026–27 Semester I)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save scenario' }));
    await waitFor(() => expect(s.patches).toHaveLength(1));
    expect(s.patches[0]!.changes).toEqual([{ op: 'drop', item_id: 'c-os' }]);
  });

  it('finds a course by its code written without a space, by title, and by the semester it is in', async () => {
    const s = server({ catalogue: titled });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await userEvent.type(searchBox(), 'zz331');
    expect(shown()).toEqual(['ZZ 331 · Computer Networks · 2026–27 Semester II · 4 credits']);
    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), 'networks');
    expect(shown()).toHaveLength(1);
    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), '2026-27 semester ii');   // a plain hyphen finds the en dash of the semester name
    expect(shown()).toEqual(['ZZ 331 · Computer Networks · 2026–27 Semester II · 4 credits']);
    await userEvent.clear(searchBox());
    expect(shown()).toHaveLength(2);   // nothing typed: every planned course is listed
  });

  it('says plainly when no planned course matches', async () => {
    const s = server({ catalogue: titled });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await userEvent.type(searchBox(), 'astronomy');
    expect(shown()).toEqual([]);
    expect(within(formOf()).getByRole('status')).toHaveTextContent('No planned course matches');
  });

  it('works from the keyboard: arrow keys move through the matches, Enter chooses, Escape clears the search', async () => {
    const s = server({ catalogue: titled });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await userEvent.type(searchBox(), 'zz');
    const options = within(formOf()).getAllByRole('option', { name: /ZZ 33/ });
    expect(searchBox()).toHaveAttribute('aria-activedescendant', options[0]!.id);   // the best match is ready for Enter
    await userEvent.keyboard('{ArrowDown}');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', options[1]!.id);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');   // wraps to the first
    expect(searchBox()).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await userEvent.keyboard('{ArrowUp}');     // and back to the last
    expect(searchBox()).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await userEvent.keyboard('{Escape}');
    expect(searchBox()).toHaveValue('');
    await userEvent.type(searchBox(), 'zz');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(within(formOf()).getByRole('group', { name: 'Planned course' })).toHaveTextContent('ZZ 331');
    expect(s.creates).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();   // Enter in the search box never submits the change
  });

  it('a chosen course can be swapped for another with "Choose a different course"', async () => {
    const s = server({ catalogue: titled });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await userEvent.type(searchBox(), 'zz330');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(formOf()).getByRole('button', { name: 'Choose a different course' }));
    expect(searchBox()).toHaveFocus();
    expect(shown()).toHaveLength(2);
  });

  it('asks for a course when none is chosen', async () => {
    const s = server();
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await userEvent.click(within(formOf()).getByRole('button', { name: 'Add change' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a planned course.');
  });

  it('with no planned courses the search is off and says why', async () => {
    const s = server({ currentPlan: { ...structuredClone(plan), semesters: plan.semesters.map((x) => ({ ...x, courses: [] })) } });
    renderScenario(s);
    await screen.findByRole('table', { name: 'Baseline vs scenario' }, wait);
    expect(searchBox()).toBeDisabled();
    expect(within(formOf()).getByText('The baseline plan has no selected courses to change.')).toBeInTheDocument();
  });

  it('a replacement is picked from the course list of the semester it replaces, and can be added by code too', async () => {
    const offeredCatalogue: CatalogueCourse[] = [
      { id: 'k1', normalized_code: 'ZZ 330', title: 'Operating Systems', credits: '4', baskets: [], could_satisfy: [] },
      { id: 'k3', normalized_code: 'ZZ 327', title: 'Compilers', credits: '5', baskets: ['systems'], could_satisfy: ['Systems basket'] },
      { id: 'k4', normalized_code: 'ZZ 301', title: 'Algorithms', credits: '4', baskets: ['theory'], could_satisfy: ['Theory & Algorithms basket'] },
    ];
    const s = server({ catalogue: offeredCatalogue, offered: { '2026-27-I': ['ZZ 330', 'ZZ 327'] } });
    renderScenario(s);
    await screen.findByRole('option', { name: /ZZ 330/ }, wait);
    await userEvent.selectOptions(within(formOf()).getByLabelText('Change type'), 'replace');
    expect(within(formOf()).getByText('Choose the planned course to replace first.')).toBeInTheDocument();
    await userEvent.type(searchBox(), 'operating');
    await userEvent.click(within(formOf()).getByRole('option', { name: /Operating Systems/ }));
    // Only what the replaced course's semester offers is listed.
    const list = await within(formOf()).findByRole('list', { name: 'Matching courses' });
    expect(within(list).getByText('ZZ 327')).toBeInTheDocument();
    expect(within(list).queryByText('ZZ 301')).not.toBeInTheDocument();
    await userEvent.click(within(formOf()).getByRole('button', { name: 'Use ZZ 327' }));
    expect(within(formOf()).getByRole('group', { name: 'Replacement course' })).toHaveTextContent('ZZ 327 · Compilers · 5 credits');
    await userEvent.click(within(formOf()).getByRole('button', { name: 'Add change' }));
    expect(within(screen.getByRole('list', { name: 'Hypothetical changes' })).getByText('Replace ZZ 330 (2026–27 Semester I) with ZZ 327 (5 credits)')).toBeInTheDocument();
    // Nothing the picker shows is an internal code or id.
    expect(formOf()).not.toHaveTextContent(/c-os|item_id|systems\b/);
  });
});
