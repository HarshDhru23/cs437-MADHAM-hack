"""CR-104 (D-16, CP-36): requirements that ask for no credits (Physical Education, the comprehensive viva) are reported while incomplete.
Record: tests/plan_fixtures.synthetic_attempts (four active semesters, each with an IN record and a PE course)."""
import unittest
from coursepath.degree_audit import evaluate_audit, incomplete_zero_credit
from coursepath.rules.loader import load_curriculum
from tests.plan_fixtures import synthetic_attempts

CURRICULUM = load_curriculum()
VIVA = ('IN 101', 'IN 102', 'IN 103', 'IN 104')
PE = ('PE 101', 'PE 102', 'PE 103', 'PE 104')


def incomplete(without=(), planned=()):
    plan = {'semesters': [{'term_id': '2026-27-I', 'courses': list(planned), 'placeholders': []}]}
    audit = evaluate_audit(CURRICULUM, {}, {'attempts': synthetic_attempts(without=without), 'current_enrolment': []}, plan)
    return {row['id']: row for row in incomplete_zero_credit(CURRICULUM, audit['projected'])}


class IncompleteZeroCredit(unittest.TestCase):
    def test_a_complete_record_has_nothing_incomplete(self):
        self.assertEqual(incomplete(), {})

    def test_a_missing_viva_is_reported_with_the_semesters_it_lacks(self):
        rows = incomplete(without=VIVA[:2])
        self.assertEqual(list(rows), ['viva'])
        self.assertEqual(rows['viva']['missing_terms'], ['2024-25-I', '2024-25-II'])

    def test_missing_physical_education_is_reported_until_the_plan_adds_it(self):
        self.assertEqual(list(incomplete(without=PE)), ['pe'])
        planned = [{'id': f'pe-{n}', 'normalized_code': code, 'credits': '0'} for n, code in enumerate(PE)]
        self.assertEqual(incomplete(without=PE, planned=planned), {})   # negative: planned PE courses make it complete

    def test_planned_courses_never_make_up_for_a_missing_viva(self):
        # The viva is a pass recorded in each active semester of the record; a plan cannot supply the past ones.
        planned = [{'id': 'v1', 'normalized_code': 'IN 105', 'credits': '0'}]
        self.assertEqual(list(incomplete(without=VIVA, planned=planned)), ['viva'])
