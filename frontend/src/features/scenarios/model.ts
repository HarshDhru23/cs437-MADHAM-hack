/**
 * Presentation helpers for scenarios (A09). They describe and label what the
 * student entered and what the server returned; they never compute credits,
 * CPI, deficits or durations. The one date conversion (inclusive last day to
 * the API's end-exclusive date) happens here, once, at the API boundary.
 */
import type { AcademicPlan, DurationChoice, ScenarioChange, ScenarioOp } from '../../api/types';
import { compareTerms, formatCredits, formatTerm, humanize } from '../../lib/format';
import { nextRegularTerm } from '../../lib/terms';

export interface PlanItem {
  id: string;
  code: string;
  term_id: string;
  credits?: string;
}

export function planItems(plan: AcademicPlan | null): PlanItem[] {
  if (!plan) return [];
  return [...plan.semesters]
    .sort((a, b) => compareTerms(a.term_id, b.term_id))
    .flatMap((s) => s.courses.map((c) => ({ id: c.id, code: c.normalized_code, term_id: s.term_id, credits: c.credits })));
}

export function itemName(items: PlanItem[], id: string | null | undefined): string {
  if (!id) return 'unknown item';
  const item = items.find((i) => i.id === id);
  return item ? `${item.code} (${formatTerm(item.term_id)})` : 'a course that is no longer in the plan';
}

export function itemCode(items: PlanItem[], id: string): string {
  return items.find((i) => i.id === id)?.code ?? id;
}

/** Letter grades the server accepts for a hypothetical grade (coursepath/imports/grades.py POINTS). */
export const LETTER_GRADES = ['A+', 'A', 'A-', 'B', 'B-', 'C', 'C-', 'D', 'E', 'F'];

/** Ops the server writes to the saved plan on apply; the rest stay hypothetical (coursepath/scenarios.py PLAN_OPS). */
export const PLAN_OPS: ScenarioOp[] = ['drop', 'postpone', 'replace'];

export const OP_LABEL: Record<ScenarioOp, string> = {
  drop: 'Drop a planned course',
  fail: 'Fail a planned course (hypothetical)',
  grade: 'Hypothetical grade',
  postpone: 'Postpone to a later term',
  replace: 'Replace with another course',
  cap: 'Cap a term’s credits',
};

export function describeChange(change: ScenarioChange, items: PlanItem[]): string {
  switch (change.op) {
    case 'drop':
      return `Drop ${itemName(items, change.item_id)}`;
    case 'fail':
      return `Hypothetical fail: ${itemName(items, change.item_id)}`;
    case 'grade':
      return `Hypothetical grade ${change.grade} for ${itemName(items, change.item_id)}`;
    case 'postpone':
      return `Postpone ${itemName(items, change.item_id)} to ${formatTerm(change.term_id)}`;
    case 'replace':
      return `Replace ${itemName(items, change.item_id)} with ${change.course.normalized_code} (${formatCredits(change.course.credits)} credits)`;
    case 'cap':
      return `Cap ${formatTerm(change.term_id)} at ${formatCredits(change.credits)} credits`;
    default: {
      const unknown = change as { op?: string };
      return `Unrecognised change (${String(unknown.op)})`;
    }
  }
}

/** A change an apply left in the scenario, in words: the change it was, or "Internship choice". */
export function describeSkipped(skipped: { op: string; item_id: string | null; term_id: string | null }, changes: ScenarioChange[], items: PlanItem[]): string {
  if (skipped.op === 'internship') return 'Internship choice';
  const found = changes.find((c) => c.op === skipped.op && ('item_id' in c ? c.item_id === skipped.item_id : c.term_id === skipped.term_id));
  return found ? describeChange(found, items) : humanize(skipped.op);
}

export function splitChanges(changes: ScenarioChange[]): { planEdits: ScenarioChange[]; hypothetical: ScenarioChange[] } {
  return {
    planEdits: changes.filter((c) => PLAN_OPS.includes(c.op)),
    hypothetical: changes.filter((c) => !PLAN_OPS.includes(c.op)),
  };
}

export interface RefusedChange {
  index: number;
  change: ScenarioChange;
  reason: string;
}

/**
 * The server's structural checks on a change list (coursepath/scenarios.py
 * apply_changes), so the editor offers only changes it will accept and a
 * rebase can name the ones that no longer match the plan. Changes run in
 * order: a dropped or failed course leaves the plan, a course with a
 * hypothetical grade takes no further changes, and a postpone must move the
 * course to a later term than where the earlier changes left it.
 * `open` lists the items that can still take a change, with their term.
 */
export function fitChanges(changes: ScenarioChange[], items: PlanItem[]): { fits: ScenarioChange[]; refused: RefusedChange[]; open: PlanItem[] } {
  const where = new Map(items.map((i) => [i.id, i.term_id]));
  const graded = new Set<string>();
  const fits: ScenarioChange[] = [];
  const refused: RefusedChange[] = [];
  changes.forEach((change, index) => {
    if (change.op === 'cap') {
      fits.push(change);
      return;
    }
    const term = where.get(change.item_id);
    let reason: string | null = null;
    if (graded.has(change.item_id)) reason = 'An earlier change gives this course a hypothetical grade or fail, so it takes no further changes.';
    else if (term === undefined) reason = 'This course is not in the plan at this point (it was dropped, or is no longer in the saved plan).';
    else if (change.op === 'postpone' && compareTerms(change.term_id, term) <= 0)
      reason = `The course is already in ${formatTerm(term)}; a postpone must move it to a later term.`;
    if (reason) {
      refused.push({ index, change, reason });
      return;
    }
    fits.push(change);
    if (change.op === 'drop' || change.op === 'fail') where.delete(change.item_id);
    else if (change.op === 'postpone') where.set(change.item_id, change.term_id);
    if (change.op === 'fail' || change.op === 'grade') graded.add(change.item_id);
  });
  const open = items.filter((i) => where.has(i.id) && !graded.has(i.id)).map((i) => ({ ...i, term_id: where.get(i.id)! }));
  return { fits, refused, open };
}

/** Later terms a course can move to: the plan's later terms plus the next two regular terms. */
export function laterTerms(plan: AcademicPlan | null, fromTerm: string): string[] {
  const terms = new Set((plan?.semesters ?? []).map((s) => s.term_id));
  const last = [...terms].sort(compareTerms).at(-1) ?? fromTerm;
  let next = nextRegularTerm(last);
  for (let i = 0; i < 2 && next; i += 1) {
    terms.add(next);
    next = nextRegularTerm(next);
  }
  return [...terms].filter((t) => compareTerms(t, fromTerm) > 0).sort(compareTerms);
}

export const DURATION_LABEL: Record<DurationChoice, string> = {
  none: 'No internship',
  three_months: '3 months',
  six_months: '6 months',
};

export function durationLabel(value: string | null | undefined): string {
  if (!value) return 'Not chosen';
  return DURATION_LABEL[value as DurationChoice] ?? humanize(value);
}

export const TARGET_LABEL: Record<string, string> = {
  open_elective: 'Open elective',
  hss: 'HSS elective',
  open_project: 'Open project',
};

export function targetLabel(value: string | null | undefined): string {
  if (!value) return 'No target basket';
  return TARGET_LABEL[value] ?? `Unrecognised basket (${value})`;
}

export const PLACEMENT_LABEL: Record<string, string> = {
  onsite_full_time: 'On site, full time',
  remote_or_part_time: 'Remote or part time',
  unknown: 'Not known yet',
};

export const MODULE_PROGRESS_LABEL: Record<string, string> = {
  proposed: 'Proposed',
  registered: 'Registered',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** The server's evaluated approval state for a module. Unknown values are shown as they are. */
export function moduleStateLabel(status: string): { label: string; tone: 'success' | 'warning' | 'danger' | 'unknown' | 'scenario'; symbol: string } {
  switch (status) {
    case 'proposed':
      return { label: 'Proposed, pending approval', tone: 'scenario', symbol: '⚑' };
    case 'approved':
      return { label: 'Approved, not yet earned', tone: 'warning', symbol: '◐' };
    case 'earned':
      return { label: 'Earned', tone: 'success', symbol: '✓' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger', symbol: '✕' };
    case 'failed':
      return { label: 'Failed', tone: 'danger', symbol: '✕' };
    default:
      return { label: `Unrecognised state (${status})`, tone: 'unknown', symbol: '?' };
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function shiftDays(iso: string, days: number): string | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The student's inclusive last day -> the API's exclusive end (the day after). */
export function inclusiveToExclusive(lastDay: string): string | null {
  return shiftDays(lastDay, 1);
}

/** The API's exclusive end -> the inclusive last day shown in the form. */
export function exclusiveToInclusive(end: string | null | undefined): string {
  return end ? (shiftDays(end, -1) ?? '') : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2027-07-31` -> `31 Jul 2027`, independent of the browser locale and time zone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  const m = ISO_DATE.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/** The server's exam overlap for a term: null means unknown (no exam dates), never "no overlap". */
export function examOverlapText(value: boolean | null | undefined): string {
  if (value === true) return ', including exams';
  if (value === false) return '';
  return ', exam overlap unknown';
}

/** A value that may be missing. Missing shows a dash, never 0. */
export function orUnavailable(value: string | number | null | undefined, format: (v: string) => string = (v) => v): string {
  if (value === null || value === undefined || value === '') return '—';
  return format(String(value));
}
