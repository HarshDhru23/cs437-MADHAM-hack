"""The audit reports the degree total (170), the credits counted toward it and the credits left (CP-20, CP-03).

Expected numbers are counted by hand in tests/plan_fixtures.py (92 counted, 78 remaining), not taken from the code under test."""
import unittest
from decimal import Decimal
from coursepath.degree_audit import evaluate_audit
from coursepath.rules.loader import load_curriculum
from tests.plan_fixtures import attempt, synthetic_attempts


def degree(attempts, plan=None):
    return evaluate_audit(load_curriculum(), {}, {'attempts': attempts, 'current_enrolment': []}, plan)['degree']


class DegreeTotals(unittest.TestCase):
    def test_empty_record_counts_nothing_of_170(self):
        actual = degree([])['actual']
        self.assertEqual(actual, {'total_credits': '170', 'counted_credits': '0', 'remaining_credits': '170'})

    def test_hand_counted_record_counts_92_with_78_remaining(self):
        actual = degree(synthetic_attempts())['actual']
        self.assertEqual((actual['total_credits'], actual['counted_credits'], actual['remaining_credits']), ('170', '92', '78'))

    def test_surplus_in_one_basket_does_not_hide_a_shortfall_in_another(self):
        # 40 credits of HS courses: only the 8 open HSS elective credits and the 16 open elective credits can take them (24 by hand); the other 16 are surplus.
        extra = [attempt(f'HS 3{i:02d}', '4', '2025-26-II') for i in range(10)]
        before = Decimal(degree(synthetic_attempts())['actual']['counted_credits'])
        after = Decimal(degree(synthetic_attempts(extra=extra))['actual']['counted_credits'])
        self.assertEqual(after - before, Decimal(24))

    def test_a_failed_course_counts_nothing(self):
        failed = [{**attempt('ES 101', '3', '2024-25-I', grade='F'), 'completion_status': 'failed'}]
        actual = degree(failed)['actual']
        self.assertEqual(actual['counted_credits'], '0')

    def test_a_planned_course_counts_only_in_the_projected_view(self):
        plan = {'semesters': [{'term_id': '2026-27-I', 'courses': [{'id': 'p1', 'normalized_code': 'CS 201', 'credits': '4'}]}]}
        views = degree(synthetic_attempts(), plan)
        self.assertEqual(views['actual']['counted_credits'], '92')
        self.assertEqual(views['projected']['counted_credits'], '96')


if __name__ == '__main__':
    unittest.main()


class RequirementRows(unittest.TestCase):
    """requirement_progress: one row per credit-bearing requirement, for the 'N more credits needed' lists (D-40)."""

    def rows(self, attempts):
        from coursepath.degree_audit import requirement_progress
        curriculum = load_curriculum()
        audit = evaluate_audit(curriculum, {}, {'attempts': attempts, 'current_enrolment': []})
        return requirement_progress(curriculum, audit['actual'])

    def test_an_empty_record_lists_38_requirements_asking_for_170_credits(self):
        # hand count from data/curricula/cse-2024.json: Foundation 1 (one side of the either/or), Institute core 9, Materials 1, HSS 7, Mathematics 4,
        # Science basket 1, BS elective 1, CSE core 9, CSE electives 3, Open electives 1, Open project 1
        rows = self.rows([])
        self.assertEqual(len(rows), 38)
        self.assertEqual(sum(Decimal(r['required_credits']) for r in rows), 170)
        self.assertEqual(sum(Decimal(r['counted_credits']) for r in rows), 0)

    def test_the_hand_counted_record_leaves_exactly_the_open_requirements(self):
        rows = self.rows(synthetic_attempts())
        open_rows = {r['id']: Decimal(r['remaining_credits']) for r in rows if Decimal(r['remaining_credits']) > 0}
        self.assertEqual(open_rows, {'hss-other': 8, 'science-basket': 8, 'bs-elective': 4, 'toc': 4, 'ai': 4, 'os': 4, 'networks': 4,
                                     'theory': 8, 'systems': 8, 'cse-general': 10, 'open-electives': 16})
        self.assertEqual(sum(open_rows.values()), 78)
        for row in rows:
            self.assertEqual(Decimal(row['required_credits']) - Decimal(row['counted_credits']), Decimal(row['remaining_credits']))

    def test_a_row_names_its_top_level_group(self):
        groups = {r['id']: r['group'] for r in self.rows([])}
        self.assertEqual(groups['hss-other'], 'Humanities and Social Sciences (GE included)')
        self.assertEqual(groups['open-electives'], 'Open electives')
        self.assertEqual(groups['theory'], 'CSE discipline electives')
