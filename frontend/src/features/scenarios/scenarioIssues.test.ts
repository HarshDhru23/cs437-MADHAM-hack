import { describe, expect, it } from 'vitest';
import type { Issue } from '../../api/types';
import type { PlanItem } from './model';
import { problems, problemText } from './scenarioIssues';

const items: PlanItem[] = [
  { id: 'a', code: 'ZZ 330', term_id: '2026-27-I' },
  { id: 'b', code: 'ZZ 331', term_id: '2026-27-I' },
  { id: 'c', code: 'ZZ 440', term_id: '2026-27-II' },
];
const issue = (code: string, severity: Issue['severity'], message: string, entity_refs: string[] = []): Issue => ({ code, severity, message, entity_refs, source_refs: [], suggested_action: '' });

describe('scenario problems', () => {
  it('lists a message that repeats for several courses once, with every course it affects', () => {
    const missing = (id: string) => issue('PREREQUISITE_MISSING', 'warning', 'Recommended preparation (CoursePath team) missing: ZZ 100', [id]);
    const found = problems([missing('a'), missing('b'), missing('a')], items);
    expect(found).toHaveLength(1);
    expect(problemText(found[0]!)).toBe('Recommended earlier course not completed or planned: ZZ 100 (affects ZZ 330, ZZ 331)');
  });

  it('keeps different messages apart and never lists notes', () => {
    const found = problems(
      [
        issue('PREREQUISITE_MISSING', 'warning', 'Recommended preparation (CoursePath team) missing: ZZ 100', ['a']),
        issue('PREREQUISITE_MISSING', 'warning', 'Recommended preparation (CoursePath team) missing: ZZ 200', ['a']),
        issue('PREREQUISITE_UNKNOWN', 'info', 'No recommendation recorded for this course in the CoursePath team list.', ['a']),
      ],
      items,
    );
    expect(found.map((p) => p.message)).toEqual([
      'Recommended earlier course not completed or planned: ZZ 100',
      'Recommended earlier course not completed or planned: ZZ 200',
    ]);
  });

  it('words a clash by the two courses, once per pair however many meetings overlap, and says when it is certain', () => {
    const clash = (severity: Issue['severity'], refs: string[]) => issue('TIMETABLE_CONFLICT', severity, 'Meetings may overlap.', refs);
    const found = problems([clash('warning', ['b', 'a', 'm1', 'm2']), clash('warning', ['a', 'b', 'm3', 'm4']), clash('error', ['a', 'c', 'm5', 'm6'])], items);
    expect(found.map((p) => p.message)).toEqual(['ZZ 330 and ZZ 331 may meet at the same time. Check the sections you pick.', 'ZZ 330 and ZZ 440 meet at the same time.']);
  });

  it('turns the timetable and load wording into student words', () => {
    const found = problems(
      [
        issue('OFFERING_NOT_IN_SNAPSHOT', 'warning', 'HS 151 is not in the complete reviewed 2026-27-II snapshot.', ['HS 151']),
        issue('OFFERING_VARIANT_MISSING', 'warning', "The selected offering variant is not in this term's snapshot for HS 151.", ['HS 151']),
        issue('LOAD_LIMIT', 'error', 'Target workload exceeds the 20-credit limit.', ['2026-27-II']),
      ],
      items,
    );
    expect(found.map(problemText)).toEqual([
      'HS 151 is not offered in 2026–27 Semester II. (affects HS 151)',
      'The version of HS 151 in your plan is not offered this semester. (affects HS 151)',
      'This semester is over the 20-credit limit. (affects 2026–27 Semester II)',
    ]);
  });

  it('hides guidance and awaiting-placeholder notes, which a student cannot act on in a scenario', () => {
    expect(
      problems(
        [issue('LOAD_GUIDANCE', 'warning', 'Normal regular-term guidance is 20-24 credits.', ['2026-27-I']), issue('PLACEHOLDER_UNRESOLVED', 'unknown', 'Select actual courses before eligibility or completion can be established.')],
        items,
      ),
    ).toEqual([]);
  });

  it('never leaves a code, a decision number or the word snapshot in a message', () => {
    const found = problems([issue('SOMETHING', 'warning', 'Odd NO_REVIEWED_ALLOCATION problem (D-07) in the snapshot', ['a'])], items);
    expect(found[0]!.message).not.toMatch(/D-\d\d|[A-Z]{2,}_[A-Z_]+|snapshot/i);
  });
});
