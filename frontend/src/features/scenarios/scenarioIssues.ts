import type { Issue } from '../../api/types';
import { formatTerm, plainMessage } from '../../lib/format';
import { cleanMessage } from '../plan/plainIssues';
import { studentIssue } from '../plan/savedPlanIssues';
import type { PlanItem } from './model';

/**
 * Scenario problems for a student: each distinct problem once, in plain words, with the courses and semesters it affects.
 * The server reports a problem per course, per meeting and per scenario; the table must not repeat it for each.
 */
export interface Problem {
  /** The sentence the student reads (no codes, no rule or team wording). */
  message: string;
  courses: string[];
  terms: string[];
}

/** Not a problem the student can act on in a scenario: guidance about a usual semester size, and a plan's placeholders awaiting a course. */
const NOT_FOR_STUDENTS = new Set(['LOAD_GUIDANCE', 'PLACEHOLDER_UNRESOLVED']);

const TERM = /^\d{4}-\d{2}-(I|II|SUMMER)$/;
const COURSE = /^[A-Z]{2,4} \d{3}[A-Z]?(\([A-Z]\))?$/;

function codeOf(ref: string, items: PlanItem[]): string | null {
  const item = items.find((i) => i.id === ref);
  if (item) return item.code;
  return COURSE.test(ref) ? ref : null;
}

const unique = <T,>(values: T[]) => [...new Set(values)];

/** The two courses of a timetable clash, from the item ids the issue names. */
function clashPair(issue: Issue, items: PlanItem[]): string[] {
  return unique(issue.entity_refs.map((r) => items.find((i) => i.id === r)?.code).filter((c): c is string => Boolean(c))).sort();
}

function wording(issue: Issue, items: PlanItem[]): string {
  if (issue.code === 'TIMETABLE_CONFLICT') {
    const pair = clashPair(issue, items);
    const certain = issue.severity === 'error';
    const names = pair.length === 2 ? `${pair[0]} and ${pair[1]}` : pair.join(', ') || 'Two courses';
    return certain ? `${names} meet at the same time.` : `${names} may meet at the same time. Check the sections you pick.`;
  }
  const text = studentIssue(issue).message;
  if (issue.code === 'LOAD_LIMIT' || /exceeds the (\d+)-credit limit/i.test(text)) {
    const limit = /(\d+)-credit limit/.exec(text)?.[1];
    return limit ? `This semester is over the ${limit}-credit limit.` : 'This semester is over the credit limit.';
  }
  const missing = /^(\S+ \S+) is not in the (?:complete )?(?:reviewed )?(\d{4}-\d{2}-(?:I|II)) (?:timetable|snapshot)\.?$/i.exec(text);
  if (missing) return `${missing[1]} is not offered in ${formatTerm(missing[2]!)}.`;
  const variant = /^The selected offering variant is not in this term's (?:snapshot|timetable) for ([A-Z]{2,4} \d{3}[A-Z]?(?:\([A-Z]\))?)\.?$/i.exec(text);
  if (variant) return `The version of ${variant[1]} in your plan is not offered this semester.`;
  return cleanMessage(plainMessage(text));
}

/** Visible problems matching `test`, one per distinct sentence, each with the courses and semesters it affects. */
export function problems(issues: Issue[] | undefined, items: PlanItem[], test: (issue: Issue) => boolean = () => true): Problem[] {
  const found = new Map<string, { courses: Set<string>; terms: Set<string> }>();
  for (const issue of issues ?? []) {
    if (issue.severity === 'info' || NOT_FOR_STUDENTS.has(issue.code) || !test(issue)) continue;
    const message = wording(issue, items);
    if (!message) continue;
    const entry = found.get(message) ?? { courses: new Set<string>(), terms: new Set<string>() };
    for (const ref of issue.entity_refs) {
      if (TERM.test(ref)) entry.terms.add(ref);
      else {
        const code = codeOf(ref, items);
        if (code && issue.code !== 'TIMETABLE_CONFLICT') entry.courses.add(code);
      }
    }
    found.set(message, entry);
  }
  return [...found].map(([message, e]) => ({ message, courses: [...e.courses].sort(), terms: [...e.terms].sort() }));
}

/** "Recommended earlier course not completed or planned: CS 330 (affects CS 331, 2026–27 Semester II)". */
export function problemText(p: Problem): string {
  const where = [...p.courses, ...p.terms.map(formatTerm)];
  return where.length > 0 ? `${p.message} (affects ${where.join(', ')})` : p.message;
}
