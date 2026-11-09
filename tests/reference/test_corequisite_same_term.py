"""Issue #19 (CP-22, D-17): a co-requisite passed on the record in the same term as the dependent course is met.

A co-requisite may be taken in the same term (eligibility.py already accepts a same-term *planned* co-requisite as conditional).
A same-term attempt that the record shows as passed is therefore eligible, with that attempt as proof. A plain prerequisite must
still come from an earlier term, and a failed or later co-requisite attempt proves nothing.
"""
import unittest
from coursepath.eligibility import evaluate_prerequisite
from coursepath.semester_plan import validate_plan

TERM = '2025-26-I'
PLAIN = {'type': 'course', 'course_id': 'ZZ 100'}
COREQ = {**PLAIN, 'co_requisite': True}


def attempt(term=TERM, status='completed', grade='A'):
    return {'id': 'h1', 'normalized_code': 'ZZ 100', 'term_id': term, 'completion_status': status, 'grade': grade}


class SameTermCorequisiteTests(unittest.TestCase):
    def test_cp22_corequisite_passed_in_the_same_term_is_eligible(self):
        result = evaluate_prerequisite(COREQ, TERM, [attempt()])
        self.assertEqual((result['status'], result['missing'], result['proof']), ('eligible', [], ['h1']))

    def test_cp22_plain_prerequisite_passed_in_the_same_term_is_still_missing(self):
        self.assertEqual(evaluate_prerequisite(PLAIN, TERM, [attempt()])['status'], 'ineligible')

    def test_cp22_corequisite_failed_in_the_same_term_or_passed_later_is_missing(self):
        self.assertEqual(evaluate_prerequisite(COREQ, TERM, [attempt(status='failed', grade='F')])['status'], 'ineligible')
        self.assertEqual(evaluate_prerequisite(COREQ, TERM, [attempt('2025-26-II')])['status'], 'ineligible')

    def test_cp22_plan_validation_accepts_the_same_term_corequisite_on_the_record(self):
        catalogue = {'ZZ 200': {'prerequisite_known': True, 'prerequisites': COREQ}}
        plan = {'semesters': [{'term_id': TERM, 'courses': [{'id': 'dep', 'normalized_code': 'ZZ 200', 'credits': '4'}]}]}
        result = validate_plan({'attempts': [attempt()], 'catalogue': catalogue, 'simple_load': True}, plan)
        self.assertEqual(result['per_course'][0]['eligibility'], 'eligible')
        self.assertEqual([i['code'] for i in result['issues'] if i['code'].startswith('PREREQUISITE')], [])


if __name__ == '__main__':
    unittest.main()
