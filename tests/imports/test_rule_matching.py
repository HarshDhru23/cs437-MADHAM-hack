"""Imported rows are matched by the approved rules instead of being flagged unmatched wholesale (D-29, CP-13)."""
import unittest
from coursepath.imports.ims import parse_ims

HEADER = 'Academic Period\tCourse No\tCourse Name\tCredit\tGrade\n'


def rows(*lines):
    text = HEADER + ''.join(f'2025-26 Semester II\t{code}\t{title}\t{credits}\t{grade}\n' for code, title, credits, grade in lines)
    result = parse_ims(text, 'synthetic')
    return result, {a['normalized_code']: a['id'] for a in result['candidate_attempts']}


def codes_for(result, attempt_id):
    return {i['code']: i['severity'] for i in result['issues'] if attempt_id in i['entity_refs']}


class RuleMatchingTests(unittest.TestCase):
    def test_courses_a_rule_can_place_are_not_flagged_unmatched(self):
        result, ids = rows(('CS 330', 'Operating Systems', '4', 'A'), ('BE 303', 'Synthetic open elective', '4', 'B'), ('PH 202', 'Synthetic physics', '4', 'A-'),
                           ('PE 101', 'Physical Education', '0', 'P'), ('IN 101', 'Viva record', '0', 'P'), ('ES 242(N)', 'Data Structures and Algorithms I', '4', 'B'))
        self.assertEqual([i for i in result['issues'] if i['code'] == 'UNMATCHED_COURSE'], [])
        self.assertEqual(codes_for(result, ids['CS 330']), {})

    def test_a_course_no_rule_can_place_is_still_flagged_for_review(self):
        # A zero-credit row whose code matches no noncredit obligation fills nothing: it needs a human look, never a silent match.
        result, ids = rows(('ZZ 900', 'Synthetic zero-credit oddity', '0', 'P'))
        self.assertEqual(codes_for(result, ids['ZZ 900']), {'UNMATCHED_COURSE': 'unknown'})

    def test_short_course_is_recorded_but_explained_not_unknown(self):
        result, ids = rows(('SC 372', 'Synthetic short course', '1', 'P'))
        self.assertEqual(codes_for(result, ids['SC 372']), {'COURSE_NOT_COUNTED': 'info'})  # D-08

    def test_team_decided_equivalences_are_notes_not_unknowns(self):
        result, ids = rows(('CS 203', 'Synthetic tools', '4', 'A'), ('CS 421', 'Synthetic elective', '4', 'B'))
        self.assertEqual(codes_for(result, ids['CS 203']), {'EQUIVALENCE_UNCONFIRMED': 'info'})
        self.assertEqual(codes_for(result, ids['CS 421']), {'EQUIVALENCE_UNCONFIRMED': 'info'})
        self.assertIn('CS 202', next(i['message'] for i in result['issues'] if ids['CS 203'] in i['entity_refs']))  # says CS 202 stays pending (D-03)

    def test_blank_grades_still_need_correction(self):
        result, ids = rows(('CS 330', 'Operating Systems', '4', ''))
        self.assertEqual(codes_for(result, ids['CS 330']).get('GRADE_UNKNOWN'), 'error')


if __name__ == '__main__':
    unittest.main()
