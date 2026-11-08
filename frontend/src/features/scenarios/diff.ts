/**
 * The "what changes" lines of a scenario against its baseline plan, in the style of a diff: `-` for what the plan has and the scenario does not,
 * `+` for what the scenario has instead. Every line comes from a value the comparison or the scenario already carries (its own changes, the
 * per-term workload, the requirement deltas, CPI, the completion term and the internship credits); nothing is computed or guessed here.
 */
import type { Scenario, ScenarioChange, ScenarioComparison } from '../../api/types';
import { formatCredits, formatTerm } from '../../lib/format';
import { durationLabel, orUnavailable, type PlanItem } from './model';

export interface DiffLine {
  kind: 'head' | 'remove' | 'add';
  text: string;
}

const REQUIREMENT_STATUS: Record<string, string> = { satisfied: 'done', pending: 'still needed', conditional: 'done if you pass your planned courses', needs_review: 'to be checked' };
const statusText = (s: string) => REQUIREMENT_STATUS[s] ?? 'to be checked';

/** Columns are separated by three spaces, like the concept's diff panel; the block keeps whitespace. */
const row = (...cells: (string | null | undefined)[]) => cells.filter((c): c is string => Boolean(c)).join('   ');

function itemRow(items: PlanItem[], id: string, term?: string, note?: string): string {
  const item = items.find((i) => i.id === id);
  if (!item) return row('A course that is no longer in the plan', note);
  return row(formatTerm(term ?? item.term_id), item.code, item.credits !== undefined ? formatCredits(item.credits) : null, note);
}

function changeLines(change: ScenarioChange, items: PlanItem[]): DiffLine[] {
  switch (change.op) {
    case 'drop':
      return [{ kind: 'remove', text: itemRow(items, change.item_id) }];
    case 'fail':
      return [{ kind: 'remove', text: itemRow(items, change.item_id, undefined, 'hypothetical fail') }];
    case 'grade': {
      const item = items.find((i) => i.id === change.item_id);
      return [{ kind: 'add', text: row(item ? formatTerm(item.term_id) : null, item ? item.code : 'A course that is no longer in the plan', `hypothetical grade ${change.grade}`) }];
    }
    case 'postpone':
      return [
        { kind: 'remove', text: itemRow(items, change.item_id) },
        { kind: 'add', text: itemRow(items, change.item_id, change.term_id) },
      ];
    case 'replace': {
      const item = items.find((i) => i.id === change.item_id);
      return [
        { kind: 'remove', text: itemRow(items, change.item_id) },
        { kind: 'add', text: row(item ? formatTerm(item.term_id) : null, change.course.normalized_code, formatCredits(change.course.credits)) },
      ];
    }
    case 'cap':
      return [{ kind: 'add', text: row(formatTerm(change.term_id), `credit cap ${formatCredits(change.credits)}`, 'hypothetical') }];
    default:
      return [];
  }
}

/** Lines for one scenario column. An empty list means the scenario matches the baseline. */
export function diffLines(comparison: ScenarioComparison, scenario: Scenario | undefined, items: PlanItem[]): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const change of scenario?.changes ?? []) lines.push(...changeLines(change, items));

  const deltas = comparison.deltas;
  // Credits per term, where the server's workload for the baseline and for the scenario differ.
  for (const [term, w] of Object.entries(deltas?.workload ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (w.baseline === null || w.scenario === null || formatCredits(w.baseline) === formatCredits(w.scenario)) continue;
    lines.push({ kind: 'remove', text: row(formatTerm(term), 'credits in the term', formatCredits(w.baseline)) });
    lines.push({ kind: 'add', text: row(formatTerm(term), 'credits in the term', formatCredits(w.scenario)) });
  }
  for (const r of deltas?.requirements ?? []) {
    const name = r.label ?? r.id;
    lines.push({ kind: 'remove', text: row(name, `${statusText(r.baseline.status)}, ${orUnavailable(r.baseline.remaining_credits, formatCredits)} credits left`) });
    lines.push({ kind: 'add', text: row(name, `${statusText(r.scenario.status)}, ${orUnavailable(r.scenario.remaining_credits, formatCredits)} credits left`) });
  }
  // CPI as the server displays it (two decimals), never the exact fraction.
  const cpiBefore = comparison.baseline?.performance?.cumulative?.display_value ?? null;
  const cpiAfter = comparison.scenario?.performance?.cumulative?.display_value ?? null;
  if (cpiBefore && cpiAfter && cpiBefore !== cpiAfter) {
    lines.push({ kind: 'remove', text: row('CPI', cpiBefore) });
    lines.push({ kind: 'add', text: row('CPI', cpiAfter, comparison.scenario?.performance?.hypothetical ? 'hypothetical' : null) });
  }
  const before = comparison.baseline?.validation?.completion_term ?? comparison.baseline?.completion_term ?? null;
  const after = comparison.scenario?.validation?.completion_term ?? comparison.scenario?.completion_term ?? null;
  if (before && after && before !== after) {
    lines.push({ kind: 'remove', text: row('Last semester', formatTerm(before)) });
    lines.push({ kind: 'add', text: row('Last semester', formatTerm(after)) });
  }
  const stay = comparison.scenario?.internship;
  if (stay && stay.duration_choice !== 'none') {
    lines.push({ kind: 'add', text: row('Internship', durationLabel(stay.duration_choice)) });
    for (const [key, label] of [['earned', 'earned'], ['approved', 'approved'], ['proposed', 'proposed']] as const) {
      const value = stay.credits?.[key];
      if (value !== null && value !== undefined && formatCredits(value) !== '0') lines.push({ kind: 'add', text: row('Internship credits', label, formatCredits(value)) });
    }
  }
  return lines;
}
