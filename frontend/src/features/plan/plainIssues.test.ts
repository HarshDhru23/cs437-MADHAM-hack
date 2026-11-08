import { describe, expect, it } from 'vitest';
import type { Issue } from '../../api/types';
import { plainIssues } from './plainIssues';

const issue = (code: string, severity: Issue['severity'], message: string): Issue => ({ code, severity, message, entity_refs: [], source_refs: [], suggested_action: '' });

describe('plainIssues', () => {
  it('hides the usual-size guidance for a light semester but keeps the 28-credit limit', () => {
    const shown = plainIssues([issue('LOAD_GUIDANCE', 'warning', 'Normal regular-term guidance is 20-24 credits.'), issue('LOAD_LIMIT', 'error', 'Target workload exceeds the 28-credit limit.')], () => undefined);
    expect(shown.map((i) => i.message)).toEqual(['This semester is over the 28-credit limit.']);
  });

  it('never shows notes, decision numbers or codes', () => {
    const shown = plainIssues([issue('STANDING_ASSUMED', 'info', 'Assuming regular standing (D-31).'), issue('SOMETHING', 'warning', 'Check this (D-12) NO_REVIEWED_ALLOCATION now.')], () => undefined);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.message).not.toMatch(/D-\d|[A-Z]{3,}_[A-Z]+|standing/i);
  });
});

describe('plainIssues: words for what the server reports about a plan being edited', () => {
  const codes: Record<string, string> = { a: 'CS 330', b: 'CS 331', c: 'ES 242(N)' };
  const codeOf = (id: string) => codes[id];
  const withRefs = (code: string, severity: Issue['severity'], refs: string[], message: string): Issue => ({ ...issue(code, severity, message), entity_refs: refs });

  it('names the two courses of a clash and merges every overlap of the same pair into one line', () => {
    const shown = plainIssues(
      [
        withRefs('TIMETABLE_CONFLICT', 'error', ['a', 'b', '2026-27-I:CS330:lecture:A1', '2026-27-I:CS331:lecture:A1'], 'Required meetings overlap.'),
        withRefs('TIMETABLE_CONFLICT', 'error', ['a', 'b', '2026-27-I:CS330:tutorial:B2', '2026-27-I:CS331:tutorial:B2'], 'Required meetings overlap.'),
        withRefs('TIMETABLE_CONFLICT', 'warning', ['a', 'c'], 'Meetings may overlap. A meeting belongs to alternatives or a group whose required meetings are not selected.'),
      ],
      codeOf,
    );
    expect(shown.map((i) => [i.severity, i.message])).toEqual([
      ['error', 'CS 330 and CS 331 meet at the same time.'],
      ['warning', 'CS 330 and ES 242(N) may meet at the same time. Check the sections you pick.'],
    ]);
    expect(shown[0]!.entityRefs).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('reads a course code in the references (the server uses codes for offering problems)', () => {
    const shown = plainIssues([withRefs('OFFERING_NOT_IN_SNAPSHOT', 'warning', ['ZZ 421'], 'ZZ 421 is not in the complete reviewed 2026-27-I snapshot.')], codeOf);
    expect(shown[0]!.message).toBe('ZZ 421 is not offered this semester.');
    expect(shown[0]!.entityRefs).toEqual(['ZZ 421']);
  });

  it('keeps the same sentence for two different semesters apart, so each semester shows its own', () => {
    const shown = plainIssues([withRefs('LOAD_LIMIT', 'error', ['2026-27-I'], 'Target workload exceeds the 28-credit limit.'), withRefs('LOAD_LIMIT', 'error', ['2027-28-I'], 'Target workload exceeds the 28-credit limit.')], codeOf);
    expect(shown).toHaveLength(2);
    expect(shown.map((i) => i.entityRefs)).toEqual([['2026-27-I'], ['2027-28-I']]);
  });

  it('puts the recommended-preparation wording in plain words without the team label', () => {
    const shown = plainIssues(
      [
        withRefs('PREREQUISITE_MISSING', 'warning', ['a'], 'Recommended preparation (CoursePath team) missing: CS 201, CS 202'),
        withRefs('PREREQUISITE_CONDITIONAL', 'warning', ['b'], 'Recommended preparation (CoursePath team) is planned earlier; it helps only if passed.'),
      ],
      codeOf,
    );
    expect(shown.map((i) => i.message)).toEqual(['CS 330 is best taken after CS 201, CS 202.', 'CS 331 needs a course that is planned earlier. That only helps if you pass it.']);
    expect(shown.map((i) => i.message).join(' ')).not.toMatch(/CoursePath|team|Recommended preparation/);
  });

  it('strips a team label that arrives in any other message', () => {
    const shown = plainIssues([issue('OTHER', 'warning', 'Check this (CoursePath team) list.')], codeOf);
    expect(shown[0]!.message).toBe('Check this list.');
  });
});
