"""Issue #154 (CP-40, CR-105): a course that is both confirmed current enrolment and planned in the same term is one course, in the degree audit as
in the plan's load check. A repeatable project such as CS 299 must not fill two requirements in "With my plan".

Expected numbers are hand counts from tests/plan_fixtures.py: the synthetic record counts 92 credits, of which CS 299 gives 4, so without CS 299 it
counts 88, and with CS 299 confirmed in 2026-27-I the current view counts 92. CS 201 is a pending CSE core course of 4 credits."""
import unittest
from coursepath.degree_audit import evaluate_audit
from coursepath.rules.loader import load_curriculum
from tests.plan_fixtures import synthetic_attempts

TERM = '2026-27-I'
ENROLLED_PROJECT = [{'id': 'cur-299', 'normalized_code': 'CS 299', 'term_id': TERM, 'credits': '4', 'confirmed': True}]


def plan(*courses, term=TERM):
    return {'semesters': [{'term_id': term, 'courses': [{'id': f'p-{n}', 'normalized_code': code, 'credits': '4'} for n, code in enumerate(courses)],
                           'placeholders': []}]}


def degree(enrolment, planned):
    return evaluate_audit(load_curriculum(), {}, {'attempts': synthetic_attempts(without=('CS 299',)), 'current_enrolment': enrolment}, planned)['degree']


class EnrolledAndPlannedOnceTests(unittest.TestCase):
    def test_cp40_the_hand_counted_start(self):
        views = degree(ENROLLED_PROJECT, None)
        self.assertEqual((views['actual']['counted_credits'], views['current']['counted_credits']), ('88', '92'))

    def test_cp40_a_project_enrolled_and_planned_in_the_same_term_counts_once(self):
        views = degree(ENROLLED_PROJECT, plan('CS 299'))
        self.assertEqual(views['current']['counted_credits'], '92')
        self.assertEqual(views['projected']['counted_credits'], views['current']['counted_credits'])

    def test_cp40_a_different_course_planned_beside_the_enrolled_project_still_counts(self):
        views = degree(ENROLLED_PROJECT, plan('CS 299', 'CS 201'))
        self.assertEqual(views['projected']['counted_credits'], '96')   # 92 + CS 201 (4); CS 299 still once

    def test_cp40_without_enrolment_the_planned_project_counts_as_before(self):
        views = degree([], plan('CS 299'))
        self.assertEqual((views['current']['counted_credits'], views['projected']['counted_credits']), ('88', '92'))
