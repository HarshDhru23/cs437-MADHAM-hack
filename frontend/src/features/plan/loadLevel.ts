/**
 * How heavy a semester is, for colour only. The numbers (credits planned and the limit) always come from the server;
 * this file only turns them into a level, a bar width and short labels. It decides nothing about the plan.
 */

/** Five steps of the load strip: nothing planned, light, normal, heavy (85% of the limit up to the limit), over the limit. */
export type LoadLevel = 'empty' | 'light' | 'normal' | 'heavy' | 'over';
/** Three steps of a column's meter: cyan below 85% of the limit, amber from 85% up to the limit, red over it. */
export type MeterLevel = 'ok' | 'warn' | 'over';

const WARN_FROM = 0.85;
const LIGHT_BELOW = 0.5;

function ratio(planned: string | undefined, limit: string | undefined): number | null {
  const p = Number(planned);
  const l = Number(limit);
  if (planned === undefined || limit === undefined || !Number.isFinite(p) || !Number.isFinite(l) || l <= 0 || p < 0) return null;
  return p / l;
}

export function loadLevel(planned: string | undefined, limit: string | undefined): LoadLevel {
  const r = ratio(planned, limit);
  if (r === null || r === 0) return 'empty';
  if (r > 1) return 'over';
  if (r >= WARN_FROM) return 'heavy';
  if (r < LIGHT_BELOW) return 'light';
  return 'normal';
}

export function meterLevel(planned: string | undefined, limit: string | undefined): MeterLevel {
  const r = ratio(planned, limit);
  if (r === null) return 'ok';
  if (r > 1) return 'over';
  return r >= WARN_FROM ? 'warn' : 'ok';
}

/** The filled part of a meter, 0 to 100. */
export function meterWidth(planned: string | undefined, limit: string | undefined): number {
  const r = ratio(planned, limit);
  return r === null ? 0 : Math.min(100, Math.round(r * 100));
}

export const LOAD_WORDS: Record<LoadLevel, string> = {
  empty: 'nothing planned',
  light: 'light load',
  normal: 'normal load',
  heavy: 'heavy load',
  over: 'over the limit',
};

/** '2026-27-I' -> '26–27 I', '2026-27-SUMMER' -> '26–27 Summer'. Labelling only. */
export function shortTerm(term: string): string {
  const match = /^(\d{4})-(\d{2})-(I|II|SUMMER)$/.exec(term);
  if (!match) return term;
  return `${match[1]!.slice(2)}–${match[2]} ${match[3] === 'SUMMER' ? 'Summer' : match[3]}`;
}

/** Adds credit strings exactly (credits have at most four decimals), for a plain total of server numbers. */
export function sumCredits(values: string[]): string {
  const scale = 10000;
  const total = values.reduce((sum, v) => sum + Math.round(Number(v) * scale), 0);
  return String(total / scale);
}
