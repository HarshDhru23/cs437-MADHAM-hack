import { describe, expect, it } from 'vitest';
import { latestTerm, nextRegularTerm, regularTermsThrough } from './terms';

describe('term helpers (labels/order only; no academic rules)', () => {
  it('next regular term after II is next year I; after I is II; summer skips to next I', () => {
    expect(nextRegularTerm('2025-26-II')).toBe('2026-27-I');
    expect(nextRegularTerm('2026-27-I')).toBe('2026-27-II');
    expect(nextRegularTerm('2025-26-SUMMER')).toBe('2026-27-I');
  });

  it('lists regular semesters from a start through admission-based semester 8', () => {
    expect(regularTermsThrough('2026-27-I', 2024, 8)).toEqual(['2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II']);
  });

  it('returns no terms when the start is already past semester 8 (extend-plan is explicit)', () => {
    expect(regularTermsThrough('2028-29-I', 2024, 8)).toEqual([]);
  });

  it('finds the chronologically latest term regardless of input order', () => {
    expect(latestTerm(['2025-26-I', '2025-26-II', '2024-25-SUMMER'])).toBe('2025-26-II');
    expect(latestTerm([])).toBeNull();
  });
});
