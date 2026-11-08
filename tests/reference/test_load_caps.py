"""Issue #17 (CP-21, CP-35, D-36): generated and edited drafts (`simple_load`) have one load limit, 28 credits in a regular semester.

D-36: "No GPS 21-credit limit, advisor cap, overload path or 20-24 guidance is applied there." Saved-plan validation (no `simple_load`)
keeps the ADV13 p. 7 rules, so GPS standing and an advisor cap still limit it.
"""
import unittest
from coursepath.plan_generation import generate_plan
from coursepath.semester_plan import validate_plan
from tests.domain.test_plan_generation import context as generation_context
from tests.plan_fixtures import synthetic_attempts


def load_issues(credits, **context):
    # Six 4-credit courses = 24 credits; one course of `credits` otherwise.
    courses = [{'id': f'c{i}', 'normalized_code': f'ZZ 4{i:02d}', 'credits': '4'} for i in range(6)] if credits == '24' else [{'id': 'c', 'normalized_code': 'ZZ 400', 'credits': credits}]
    issues = validate_plan(context, {'semesters': [{'term_id': '2026-27-I', 'courses': courses}]})['issues']
    return [i['message'] for i in issues if i['code'] in ('LOAD_LIMIT', 'OVERLOAD_APPROVAL_REQUIRED')]


class DraftLoadLimitTests(unittest.TestCase):
    def test_cp21_a_draft_with_gps_standing_holds_24_credits(self):
        # 24 <= 28 (D-36), although 24 > 21 (the GPS limit of saved-plan validation).
        self.assertEqual(load_issues('24', standing='GPS', simple_load=True), [])

    def test_cp21_a_draft_ignores_the_advisor_cap(self):
        self.assertEqual(load_issues('24', standing='regular', advisor_cap='20', simple_load=True), [])

    def test_cp21_a_draft_still_stops_at_28_credits_whatever_the_standing(self):
        for standing in ('GPS', 'regular', 'unknown'):
            self.assertEqual(load_issues('29', standing=standing, simple_load=True), ['Target workload exceeds the 28-credit limit.'], standing)

    def test_cp21_saved_plan_validation_keeps_the_gps_and_advisor_limits(self):
        self.assertEqual(load_issues('24', standing='GPS'), ['Target workload exceeds the 21-credit limit.'])
        self.assertEqual(load_issues('24', standing='regular', advisor_cap='20'), ['Target workload exceeds the 20-credit limit.'])

    def test_cp35_a_generated_draft_for_a_gps_student_reports_no_load_error(self):
        result = generate_plan(generation_context(synthetic_attempts(), standing='GPS'))
        self.assertTrue(any(c > 21 for c in map(float, result['summary']['credits_by_term'].values())), 'the draft packs some term above 21 credits (D-40)')
        self.assertEqual([i['message'] for i in result['validation']['issues'] if i['code'] == 'LOAD_LIMIT'], [])


if __name__ == '__main__':
    unittest.main()
