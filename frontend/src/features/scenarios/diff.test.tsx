/**
 * The what-if diff (CP-28): lines come only from what the scenario and the comparison already carry. Course names and semesters are the shared
 * plan fixture's (ZZ 330 in 2026–27 Semester I, ZZ 331 in 2026–27 Semester II, 4 credits each).
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Scenario, ScenarioChange, ScenarioComparison, ScenarioEvaluation } from '../../api/types';
import { DiffBlock } from './DiffBlock';
import { diffLines } from './diff';
import type { PlanItem } from './model';

const items: PlanItem[] = [
  { id: 'c-os', code: 'ZZ 330', term_id: '2026-27-I', credits: '4' },
  { id: 'c-net', code: 'ZZ 331', term_id: '2026-27-II', credits: '4' },
];

const scenario = (changes: ScenarioChange[]): Scenario =>
  ({ id: 'sc-1', revision: 1, plan_id: 'plan-1', label: 'Lighter year', baseline_record_revision: 1, baseline_plan_revision: 1, rule_version: 'v', changes, internship: null, award_ids: [] }) as Scenario;

const evaluation = (over: Partial<ScenarioEvaluation> = {}): ScenarioEvaluation => ({ completion_term: null, internship: null, issues: [], ...over }) as unknown as ScenarioEvaluation;

const comparison = (over: Partial<ScenarioComparison> = {}): ScenarioComparison => ({
  scenario_id: 'sc-1',
  baseline_record_revision: 1,
  baseline_plan_revision: 1,
  rule_version: 'v',
  stale: false,
  baseline: evaluation(),
  scenario: evaluation(),
  deltas: { requirements: [], new_issues: [], resolved_issues: [], downstream_affected: [], workload: {}, cpi: { baseline: null, scenario: null, hypothetical: false }, meeting_checks: {} },
  issues: [],
  ...over,
});

const texts = (lines: ReturnType<typeof diffLines>) => lines.map((l) => `${l.kind === 'remove' ? '-' : '+'} ${l.text}`);

describe('diffLines', () => {
  it('has no lines when the scenario matches its baseline', () => {
    expect(diffLines(comparison(), scenario([]), items)).toEqual([]);
  });

  it('a drop is one "-" line with the course, its semester and its credits', () => {
    expect(texts(diffLines(comparison(), scenario([{ op: 'drop', item_id: 'c-os' }]), items))).toEqual(['- 2026–27 Semester I   ZZ 330   4']);
  });

  it('a postpone removes the course from its semester and adds it to the later one', () => {
    expect(texts(diffLines(comparison(), scenario([{ op: 'postpone', item_id: 'c-os', term_id: '2027-28-I' }]), items))).toEqual([
      '- 2026–27 Semester I   ZZ 330   4',
      '+ 2027–28 Semester I   ZZ 330   4',
    ]);
  });

  it('a replacement removes one course and adds the other in the same semester', () => {
    const change: ScenarioChange = { op: 'replace', item_id: 'c-net', course: { normalized_code: 'ZZ 327', credits: '5' } };
    expect(texts(diffLines(comparison(), scenario([change]), items))).toEqual(['- 2026–27 Semester II   ZZ 331   4', '+ 2026–27 Semester II   ZZ 327   5']);
  });

  it('a hypothetical fail, grade and cap are named as hypothetical', () => {
    const lines = texts(
      diffLines(
        comparison(),
        scenario([
          { op: 'fail', item_id: 'c-os' },
          { op: 'grade', item_id: 'c-net', grade: 'B' },
          { op: 'cap', term_id: '2026-27-II', credits: '20' },
        ]),
        items,
      ),
    );
    expect(lines).toEqual(['- 2026–27 Semester I   ZZ 330   4   hypothetical fail', '+ 2026–27 Semester II   ZZ 331   hypothetical grade B', '+ 2026–27 Semester II   credit cap 20   hypothetical']);
  });

  it('a change on a course the plan no longer has says so in words, never an internal id', () => {
    const lines = texts(diffLines(comparison(), scenario([{ op: 'drop', item_id: 'gone-id' }]), items));
    expect(lines).toEqual(['- A course that is no longer in the plan']);
    expect(lines.join(' ')).not.toContain('gone-id');
  });

  it('lists credits per term only where the server’s numbers differ', () => {
    const deltas = { ...comparison().deltas!, workload: { '2026-27-I': { baseline: '24', scenario: '20' }, '2026-27-II': { baseline: '20', scenario: '20.0' } } };
    expect(texts(diffLines(comparison({ deltas }), scenario([]), items))).toEqual(['- 2026–27 Semester I   credits in the term   24', '+ 2026–27 Semester I   credits in the term   20']);
  });

  it('lists each requirement that changes with its before and after, from the server', () => {
    const deltas = {
      ...comparison().deltas!,
      requirements: [{ id: 'cse-core', label: 'CSE core', baseline: { status: 'pending', remaining_credits: '8' }, scenario: { status: 'pending', remaining_credits: '12' } }],
    };
    expect(texts(diffLines(comparison({ deltas }), scenario([]), items))).toEqual(['- CSE core   still needed, 8 credits left', '+ CSE core   still needed, 12 credits left']);
  });

  it('lists CPI only when it differs, as the server displays it, and labels a hypothetical one', () => {
    const cpi = (display: string, hypothetical = false) => evaluation({ performance: { cumulative: { display_value: display }, hypothetical } as unknown as ScenarioEvaluation['performance'] });
    expect(diffLines(comparison({ baseline: cpi('9.23'), scenario: cpi('9.23', true) }), scenario([]), items)).toEqual([]);
    expect(texts(diffLines(comparison({ baseline: cpi('9.23'), scenario: cpi('8.90', true) }), scenario([]), items))).toEqual(['- CPI   9.23', '+ CPI   8.90   hypothetical']);
  });

  it('lists the last semester only when both the baseline and the scenario have one and they differ', () => {
    const moved = comparison({ baseline: evaluation({ completion_term: '2027-28-I' }), scenario: evaluation({ completion_term: '2027-28-II' }) });
    expect(texts(diffLines(moved, scenario([]), items))).toEqual(['- Last semester   2027–28 Semester I', '+ Last semester   2027–28 Semester II']);
    expect(diffLines(comparison({ baseline: evaluation({ completion_term: null }), scenario: evaluation({ completion_term: '2027-28-II' }) }), scenario([]), items)).toEqual([]);
  });

  it('lists an internship and only the internship credits the server reports above zero', () => {
    const internship = { duration_choice: 'three_months', credits: { earned: '0', approved: null, proposed: '4' } } as unknown as ScenarioEvaluation['internship'];
    const lines = texts(diffLines(comparison({ scenario: evaluation({ internship }) }), scenario([]), items));
    expect(lines).toEqual(['+ Internship   3 months', '+ Internship credits   proposed   4']);
  });
});

describe('DiffBlock', () => {
  it('is a named group with a violet header line and one marked line per change', () => {
    render(<DiffBlock comparison={comparison()} scenario={scenario([{ op: 'postpone', item_id: 'c-os', term_id: '2027-28-I' }])} label="Lighter year" items={items} />);
    const block = screen.getByRole('group', { name: 'Changes in Lighter year compared with your plan' });
    // The columns are separated by runs of spaces that text matchers collapse, so compare the exact text of each line.
    const line = (text: string) => Array.from(block.querySelectorAll('.diff-line')).find((el) => el.textContent === text);
    expect(line('@@ your plan → what-if: Lighter year @@')).toHaveClass('diff-head');
    expect(line('- 2026–27 Semester I   ZZ 330   4')).toHaveClass('diff-remove');
    expect(line('+ 2027–28 Semester I   ZZ 330   4')).toHaveClass('diff-add');
    expect(block).toHaveAttribute('tabindex', '0'); // a block that scrolls sideways must be reachable by keyboard
  });

  it('says so plainly when nothing differs, and invents no line', () => {
    render(<DiffBlock comparison={comparison()} scenario={scenario([])} label="Same year" items={items} />);
    const block = screen.getByRole('group', { name: 'Changes in Same year compared with your plan' });
    expect(within(block).getByText('No difference from your plan.')).toBeInTheDocument();
    expect(block.querySelectorAll('.diff-add, .diff-remove')).toHaveLength(0);
  });

  it('shows no codes, ids or revision numbers', () => {
    render(<DiffBlock comparison={comparison()} scenario={scenario([{ op: 'drop', item_id: 'c-os' }])} label="Lighter year" items={items} />);
    expect(screen.getByRole('group')).not.toHaveTextContent(/c-os|revision|D-\d\d|[A-Z]{3,}_[A-Z_]{3,}/);
  });
});
