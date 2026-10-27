/**
 * Input checks that mirror the server's own validation, so a student gets a
 * specific message instead of a generic 400. They decide nothing academic; the
 * server re-validates everything.
 */

/** Same as `CODE` in coursepath/imports/normalization.py. */
const COURSE_CODE = /^[A-Za-z]{2,5}\s*\d{2,4}(?:\s*\([^\n)]{1,20}\))?$/;

/** Same as the schema `decimal` pattern and serialization.decimal_value bounds. */
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/;
const DECIMAL_MAX = 10000;

export function isCourseCode(raw: string): boolean {
  return COURSE_CODE.test(raw.trim());
}

/** Same spacing rules as normalize_code on the server: `cs330` → `CS 330`, `ES 242 (N)` → `ES 242(N)`. */
export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^([A-Z]+)\s*(\d+)/, '$1 $2')
    .replace(/\s+\(/g, '(');
}

export function isDecimalString(value: string): boolean {
  // The bound check compares magnitudes only; no academic arithmetic.
  return DECIMAL.test(value) && Number(value) <= DECIMAL_MAX;
}
