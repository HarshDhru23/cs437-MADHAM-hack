import { describe, expect, it } from 'vitest';
import { describeCorrection, formatCredits, formatTerm, humanize, termSortKey } from './format';

describe('formatCredits', () => {
  it.each([
    ['4', '4'],
    ['4.0', '4'],
    ['1.50', '1.5'],
    ['0', '0'],
    ['10.25', '10.25'],
    ['170', '170'],
  ])('trims %s to %s without float arithmetic', (input, expected) => {
    expect(formatCredits(input)).toBe(expected);
  });

  it('never turns a missing value into zero', () => {
    expect(formatCredits(null)).toBe('Unknown');
    expect(formatCredits(undefined)).toBe('Unknown');
    expect(formatCredits('')).toBe('Unknown');
  });

  it('keeps long exact decimals intact (no rounding)', () => {
    expect(formatCredits('3.333333333333333333')).toBe('3.333333333333333333');
  });
});

describe('formatTerm', () => {
  it.each([
    ['2026-27-I', '2026–27 Semester I'],
    ['2026-27-II', '2026–27 Semester II'],
    ['2026-27-SUMMER', '2026–27 Summer'],
    ['weird', 'weird'],
  ])('%s -> %s', (id, label) => expect(formatTerm(id)).toBe(label));

  it('sorts terms chronologically, not by string order of input rows', () => {
    const ids = ['2025-26-II', '2024-25-SUMMER', '2024-25-II', '2025-26-I', '2024-25-I'];
    expect([...ids].sort((a, b) => termSortKey(a).localeCompare(termSortKey(b)))).toEqual([
      '2024-25-I',
      '2024-25-II',
      '2024-25-SUMMER',
      '2025-26-I',
      '2025-26-II',
    ]);
  });
});

describe('humanize', () => {
  it('turns stable codes into readable fallbacks without inventing meaning', () => {
    expect(humanize('world-civilizations')).toBe('World civilizations');
    expect(humanize('needs_review')).toBe('Needs review');
  });
});

describe('describeCorrection', () => {
  it('shows a field correction with its source and accepted values', () => {
    expect(describeCorrection({ field: 'title', raw: 'Synthetic Calculs', accepted: 'Synthetic Calculus' })).toBe('Title: “Synthetic Calculs” → “Synthetic Calculus”');
  });

  it('lists only the fields an accepted re-import changed', () => {
    const base = { normalized_code: 'ZZ 104', title: 'Synthetic', credits: '2', term_id: '2024-25-II', instance_id: null };
    expect(describeCorrection({ field: 'reimport', raw: { ...base, grade: 'B' }, accepted: { ...base, grade: 'A-', credits: '3' } })).toBe(
      'Re-import: credits “2” → “3”; grade “B” → “A-”',
    );
  });
});
