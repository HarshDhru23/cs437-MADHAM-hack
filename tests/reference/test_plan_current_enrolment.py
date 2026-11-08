"""Issue #11 (CP-05, CP-22, D-17): plan validation counts confirmed current enrolment as recommended preparation taken earlier.

CP-05 warns only when the recommended course is "not completed or planned earlier". A confirmed current course in an earlier term is
not yet passed, so like an earlier planned course it makes the later course `conditional` ("helps only if passed"), never `eligible`.
Only confirmed rows count, as in plan_generation.py (`if r.get('confirmed')`) and degree_audit.py (`if row.get('confirmed')`).
"""
from copy import deepcopy
import unittest
from coursepath.semester_plan import validate_plan
from coursepath.scenarios import compare_scenario
from coursepath.plan_generation import generate_plan
from tests.domain.test_plan_generation import context as generation_context
from tests.plan_fixtures import synthetic_attempts
from tests.domain.test_scenarios import context as scenario_context, history, planned, scenario

CATALOGUE = {'ZZ 200': {'prerequisite_known': True, 'prerequisites': {'type': 'course', 'course_id': 'ZZ 100'}}}


def enrolment(term='2026-27-I', confirmed=True):
    return [{'id': 'ce1', 'normalized_code': 'ZZ 100', 'term_id': term, 'credits': '4', 'confirmed': confirmed}]


def plan(term='2026-27-II'):
    return {'semesters': [{'term_id': term, 'courses': [{'id': 'dep', 'normalized_code': 'ZZ 200', 'credits': '4'}]}]}


def check(current_enrolment, term='2026-27-II'):
    result = validate_plan({'attempts': [], 'catalogue': CATALOGUE, 'current_enrolment': current_enrolment, 'simple_load': True}, plan(term))
    return result['per_course'][0]['eligibility'], [i['code'] for i in result['issues'] if i['code'].startswith('PREREQUISITE')]


class CurrentEnrolmentPreparationTests(unittest.TestCase):
    def test_cp05_confirmed_current_enrolment_in_an_earlier_term_is_conditional(self):
        # ZZ 100 confirmed in 2026-27-I, ZZ 200 planned in 2026-27-II: taken earlier but not yet passed -> conditional (not eligible, not missing).
        self.assertEqual(check(enrolment()), ('conditional', ['PREREQUISITE_CONDITIONAL']))

    def test_cp05_unconfirmed_enrolment_does_not_count(self):
        self.assertEqual(check(enrolment(confirmed=False)), ('ineligible', ['PREREQUISITE_MISSING']))

    def test_cp22_current_enrolment_in_the_same_term_is_not_earlier_preparation(self):
        # ZZ 100 is not a co-requisite, so taking it in the same term as ZZ 200 is not "earlier".
        self.assertEqual(check(enrolment('2026-27-II')), ('ineligible', ['PREREQUISITE_MISSING']))

    def test_cp28_scenario_validation_counts_confirmed_current_enrolment(self):
        record = {'revision': 4, 'attempts': [history('h1', 'ES 242', 'A', '2024-25-II')], 'current_enrolment': enrolment()}
        base = {'record': record, 'plan': {'id': 'plan-1', 'revision': 2, 'semesters': [{'term_id': '2026-27-II', 'courses': [planned('dep', 'ZZ 200')]}]},
                'rule_version': 'cse-2024-draft-v1'}
        result = compare_scenario(scenario_context(), deepcopy(base), scenario())
        rows = {r['id']: r['eligibility'] for r in result['baseline']['validation']['per_course']}
        self.assertEqual(rows['dep'], 'conditional')
        self.assertNotIn('PREREQUISITE_MISSING', [i['code'] for i in result['baseline']['validation']['issues']])

    def test_cp05_generated_draft_validation_counts_confirmed_current_enrolment(self):
        # The fixture record minus ES 242, which is instead confirmed current enrolment in 2026-27-I. Every generated course comes later,
        # so none may report ES 242 as missing (team list: CS 329, CS 330, CS 331 <- ES 242).
        rows = [{'id': 'ce1', 'normalized_code': 'ES 242', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True}]
        result = generate_plan(generation_context(synthetic_attempts(without=('ES 242',)), current_enrolment=rows))
        missing = [i['message'] for i in result['validation']['issues'] if i['code'] == 'PREREQUISITE_MISSING' and 'ES 242' in i['message']]
        self.assertEqual(missing, [])
        self.assertIn('conditional', {r['eligibility'] for r in result['validation']['per_course'] if r['id'].endswith('CS331')})


if __name__ == '__main__':
    unittest.main()
