import type { Issue } from '../../api/types';

/**
 * Plan checks the student should see, in plain words. Only errors, warnings and approval requests are shown; notes ("info") and
 * "unknown" states are not. Messages never carry issue codes, rule names or decision numbers.
 */
const SHOWN = new Set(['error', 'warning', 'approval_required']);
/** Guidance about a usual semester size is not a problem the student has to act on; the 28-credit limit is the only load message. */
const HIDDEN_CODES = new Set(['LOAD_GUIDANCE']);

const COURSE_CODE = /^[A-Z]{2,5} \d{2,4}(?:[A-Z]|-[A-Z0-9]{1,6})?(?:\([^)]{1,20}\))?$/;
const TERM_ID = /^20\d\d-\d\d-(?:I|II|SUMMER)$/;

/** What the plan words say for each issue code: the course codes the issue is about (in order, no repeats) and its severity. */
const PLAIN: Record<string, (courses: string[], severity: string, message: string) => string | null> = {
  LOAD_LIMIT: (_courses, _severity, message) => `This semester is over the ${/(\d+)-credit limit/.exec(message)?.[1] ?? '28'}-credit limit.`,   // 28 for a semester, 10 for a summer
  OVERLOAD_APPROVAL_REQUIRED: () => 'This semester is over the 28-credit limit.',
  OFFERING_NOT_IN_SNAPSHOT: ([code]) => `${code ?? 'This course'} is not offered this semester.`,
  DUPLICATE_COURSE: ([code]) => `${code ?? 'This course'} is already in your plan or already completed.`,
  PREREQUISITE_MISSING: ([code], _severity, message) => {
    const missing = /Recommended preparation \(CoursePath team\) missing:\s*(.+)$/.exec(message)?.[1];
    return missing ? `${code ?? 'This course'} is best taken after ${missing}.` : null;
  },
  PREREQUISITE_CONDITIONAL: ([code], _severity, message) =>
    /^Recommended preparation \(CoursePath team\)/.test(message) ? `${code ?? 'This course'} needs a course that is planned earlier. That only helps if you pass it.` : null,
  TIMETABLE_CONFLICT: ([a, b], severity) =>
    a && b ? (severity === 'error' ? `${a} and ${b} meet at the same time.` : `${a} and ${b} may meet at the same time. Check the sections you pick.`) : null,
};

/** Strips anything a student should not read: decision numbers, upper-case codes, "snapshot", "(team ...)" asides. */
export function cleanMessage(message: string): string {
  return message
    .replace(/\s*\((?:[^()]*\b)?D-\d+\b[^()]*\)/g, '')
    .replace(/\s*\(CoursePath team\)/gi, '')
    .replace(/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/g, '')
    .replace(/\b(?:reviewed |draft |complete |published )*(?:timetable )?snapshot\b/gi, 'timetable')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .trim();
}

export interface PlainIssue {
  key: string;
  severity: 'error' | 'warning' | 'approval_required';
  message: string;
  /** Everything the issue points at: term IDs, planned item IDs, course codes and meeting IDs, as the server sent them. */
  entityRefs: string[];
}

/**
 * `codeOf` turns a planned item ID into its course code. A reference that already is a course code (the server uses codes for
 * offering problems) is used as it is. Issues with the same words and the same semesters are merged into one line.
 */
export function plainIssues(issues: Issue[], codeOf: (id: string) => string | undefined): PlainIssue[] {
  const merged = new Map<string, PlainIssue>();
  for (const i of issues) {
    if (!SHOWN.has(i.severity) || HIDDEN_CODES.has(i.code)) continue;
    const courses: string[] = [];
    for (const ref of i.entity_refs) {
      const code = codeOf(ref) ?? (COURSE_CODE.test(ref) ? ref : undefined);
      if (code && !courses.includes(code)) courses.push(code);
    }
    const message = PLAIN[i.code]?.(courses, i.severity, i.message) ?? cleanMessage(i.message);
    if (!message) continue;
    const key = `${i.severity}|${message}|${i.entity_refs.filter((r) => TERM_ID.test(r)).join(',')}`;
    const found = merged.get(key);
    if (found) {
      for (const ref of i.entity_refs) if (!found.entityRefs.includes(ref)) found.entityRefs.push(ref);
    } else {
      merged.set(key, { key, severity: i.severity as PlainIssue['severity'], message, entityRefs: [...i.entity_refs] });
    }
  }
  return [...merged.values()];
}

/** a - b for decimal credit strings, clamped at zero; used only to word a progress line from two server numbers. */
export function creditsLeft(a: string, b: string): string {
  const scale = 10000;
  const left = Math.max(0, Math.round(Number(a) * scale) - Math.round(Number(b) * scale));
  return String(left / scale);
}
