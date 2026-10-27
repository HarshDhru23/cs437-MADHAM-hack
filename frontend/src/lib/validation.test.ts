import { describe, expect, it } from 'vitest';
import { isCourseCode, isDecimalString, normalizeCode } from './validation';

// Expected values follow the server's rules: coursepath/imports/normalization.py
// (CODE, normalize_code) and the schema `decimal` / serialization.decimal_value.
describe('client-side checks mirror the server', () => {
  it.each(['CS 330', 'cs330', 'ES 242(N)', 'ES 242 (N)', 'HS 191', 'IN 498', 'ABCDE 1234', 'MA 10'])('accepts course code %s', (code) => {
    expect(isCourseCode(code)).toBe(true);
  });

  it.each(['CS 330A', 'C 330', 'CS 3', 'CS 12345', 'ABCDEF 101', 'CS-330', ''])('rejects course code %s', (code) => {
    expect(isCourseCode(code)).toBe(false);
  });

  it('normalizes spacing like the server', () => {
    expect(normalizeCode('cs330')).toBe('CS 330');
    expect(normalizeCode('  es   242 (n) ')).toBe('ES 242(N)');
    expect(normalizeCode('PE 101')).toBe('PE 101');
  });

  it.each(['0', '4', '1.5', '0.25', '10000', '2.1234'])('accepts decimal %s', (value) => {
    expect(isDecimalString(value)).toBe(true);
  });

  it.each(['04', '1.23456', '10000.5', '10001', '-1', '1e3', '.5', '4.', ' 4', ''])('rejects decimal %s', (value) => {
    expect(isDecimalString(value)).toBe(false);
  });
});
