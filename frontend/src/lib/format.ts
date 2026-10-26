/**
 * Presentation-only formatting. Credits arrive as decimal strings from the
 * server; we only trim redundant zeroes in the string. No arithmetic.
 */

export function formatCredits(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') return 'Unknown';
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

const TERM = /^(\d{4})-(\d{2})-(I|II|SUMMER)$/;

export function formatTerm(termId: string): string {
  const match = TERM.exec(termId);
  if (!match) return termId;
  const [, start, end, part] = match;
  return part === 'SUMMER' ? `${start}–${end} Summer` : `${start}–${end} Semester ${part}`;
}

/** Chronological sort key: academic year, then I < II < SUMMER. */
export function termSortKey(termId: string): string {
  const match = TERM.exec(termId);
  if (!match) return `9999-${termId}`;
  const order = { I: '1', II: '2', SUMMER: '3' }[match[3] as 'I' | 'II' | 'SUMMER'];
  return `${match[1]}-${order}`;
}

export function compareTerms(a: string, b: string): number {
  return termSortKey(a).localeCompare(termSortKey(b));
}

export function humanize(code: string): string {
  const words = code.replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CORRECTED_FIELD: Record<string, string> = { normalized_code: 'code', title: 'title', credits: 'credits', grade: 'grade', term_id: 'term', instance_id: 'instance' };

/**
 * One stored correction as text. A field correction has scalar raw/accepted
 * values; an accepted re-import stores whole field maps, so only the fields
 * whose values differ are listed.
 */
export function describeCorrection(correction: { field: string; raw: unknown; accepted: unknown }): string {
  const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isMap(correction.raw) && !isMap(correction.accepted)) {
    return `${humanize(correction.field)}: “${String(correction.raw ?? '')}” → “${String(correction.accepted ?? '')}”`;
  }
  const raw = isMap(correction.raw) ? correction.raw : {};
  const accepted = isMap(correction.accepted) ? correction.accepted : {};
  const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const changes = [...new Set([...Object.keys(raw), ...Object.keys(accepted)])]
    .filter((key) => text(raw[key]) !== text(accepted[key]))
    .map((key) => `${CORRECTED_FIELD[key] ?? humanize(key).toLowerCase()} “${text(raw[key])}” → “${text(accepted[key])}”`);
  return `${correction.field === 'reimport' ? 'Re-import' : humanize(correction.field)}: ${changes.join('; ') || 'no field values changed'}`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(date) + ' IST';
}
