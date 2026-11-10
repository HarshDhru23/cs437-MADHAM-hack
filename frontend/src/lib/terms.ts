/**
 * Calendar labelling helpers for term IDs (`2026-27-I`). They order terms and
 * propose default plan columns; they do not decide durations, offerings or any
 * academic rule. The default horizon (semester 8) is extendable by the student.
 */
import { compareTerms } from './format';

const TERM = /^(\d{4})-(\d{2})-(I|II|SUMMER)$/;

function yearLabel(start: number): string {
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** 'I' (odd semester), 'II' (even semester) or 'SUMMER'; null for anything that is not a term ID. */
export function termKind(termId: string): 'I' | 'II' | 'SUMMER' | null {
  return (TERM.exec(termId)?.[3] as 'I' | 'II' | 'SUMMER' | undefined) ?? null;
}

/**
 * The terms a planned course can move to (D-50): an odd semester to another odd semester, an even one to another even one, a summer break to
 * another summer break. A course is offered in the same parity of semester year after year, so a move to the other parity would put it
 * where it is not offered. The term it is in is always in the list.
 */
export function moveTargets(from: string, all: string[]): string[] {
  const kind = termKind(from);
  return all.filter((t) => t === from || (kind !== null && termKind(t) === kind));
}

export function nextRegularTerm(termId: string): string | null {
  const m = TERM.exec(termId);
  if (!m) return null;
  const start = Number(m[1]);
  return m[3] === 'I' ? `${yearLabel(start)}-II` : `${yearLabel(start + 1)}-I`;
}

/** Regular semester index for an admission year (2024-25-I is semester 1 for 2024 entry). */
export function semesterIndex(termId: string, admissionYear: number): number | null {
  const m = TERM.exec(termId);
  if (!m || m[3] === 'SUMMER') return null;
  return (Number(m[1]) - admissionYear) * 2 + (m[3] === 'I' ? 1 : 2);
}

export function regularTermsThrough(start: string, admissionYear: number, lastSemester: number): string[] {
  const out: string[] = [];
  let term: string | null = start;
  while (term) {
    const index = semesterIndex(term, admissionYear);
    if (index === null || index > lastSemester) break;
    out.push(term);
    term = nextRegularTerm(term);
  }
  return out;
}

export function latestTerm(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return [...terms].sort(compareTerms).at(-1) ?? null;
}

/**
 * Latest term with a completed attempt. In-progress, failed-only or unknown
 * rows do not prove a later term has finished, so they never advance the
 * current term on their own.
 */
export function latestCompletedTerm(attempts: { term_id: string; completion_status: string }[]): string | null {
  return latestTerm(attempts.filter((a) => a.completion_status === 'completed').map((a) => a.term_id));
}
