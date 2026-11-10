from copy import deepcopy
import unittest
from coursepath.performance import calculate_performance
from coursepath.imports.grades import POINTS, classify_grade
from tests.domain.test_audit import attempt

POLICY = {'id': 'synthetic', 'review_status': 'reviewed', 'points': {k: str(v) for k, v in POINTS.items()},
          'excluded_grades': ['P'], 'rounding': 'half_up', 'decimal_places': 2, 'cpi_cap': '10', 'spi_cap': None,
          'repeat_policy': 'count_all', 'additional_learning_policy': 'include', 'source_refs': ['synthetic']}


class PerformanceTests(unittest.TestCase):
    def test_cp14_grade_completion_exposure_and_performance_separate(self):
        for grade, status, point in [('D', 'completed', '4'), ('E', 'failed', '2'), ('F', 'failed', '0'), ('P', 'completed', None), ('', 'unknown', None), ('Z', 'unknown', None)]:
            result = classify_grade(grade)
            self.assertEqual(result['completion_status'], status)
            self.assertEqual(str(result['performance_points']) if result['performance_points'] is not None else None, point)
            self.assertIsNone(result['prerequisite_exposure'])

    def test_cp15_independent_849_over_92_arithmetic_control(self):
        # Synthetic arithmetic oracle only: 21*10 + 71*9 = 849, 21+71 = 92.
        result = calculate_performance([attempt('a', 'ZZ 100', '21', grade='A'), attempt('b', 'ZZ 200', '71', grade='A-')], POLICY)
        self.assertEqual(result['cumulative']['grade_points'], '849')
        self.assertEqual(result['cumulative']['performance_credits'], '92')
        self.assertEqual(result['cumulative']['display_value'], '9.23')

    def test_cp16_weighted_terms_failed_denominator_p_and_zero_credit(self):
        result = calculate_performance([attempt('a', 'ZZ 100', '2', grade='A'), attempt('b', 'ZZ 200', '4', grade='B'),
                                        attempt('p', 'ZZ 300', '5', grade='P'), attempt('zero', 'PE 101', '0', grade='A'),
                                        attempt('e', 'ZZ 400', '2', status='failed', grade='E', term_id='2024-25-II'),
                                        attempt('f', 'ZZ 500', '2', status='failed', grade='F', term_id='2024-25-II')], POLICY)
        self.assertEqual([t['display_value'] for t in result['terms']], ['8.67', '1.00'])
        self.assertEqual(result['cumulative']['performance_credits'], '10')
        self.assertEqual(result['cumulative']['grade_points'], '56')
        self.assertEqual(len(result['cumulative']['excluded_attempts']), 2)

    def test_cap_unavailable_unknown_repeat_and_rounding_policies(self):
        self.assertEqual(calculate_performance([attempt('a', 'ZZ 100', grade='A+')], POLICY)['cumulative']['display_value'], '10.00')
        self.assertEqual(calculate_performance([attempt('a', 'ZZ 100', grade='P')], POLICY)['cumulative']['display_value'], None)
        policy = {**POLICY, 'rounding': None, 'repeat_policy': None}
        result = calculate_performance([attempt('a', 'ZZ 100'), attempt('b', 'ZZ 100'), attempt('z', 'ZZ 200', grade='W')], policy)
        self.assertFalse(result['cumulative']['complete'])
        self.assertIsNone(result['cumulative']['display_value'])
        self.assertTrue(result['issues'])


class BestGradeRepeatTests(unittest.TestCase):
    """D-15: a repeated course counts once, with its best grade; project registrations are separate courses."""

    def test_cp15_repeat_keeps_best_grade_and_projects_stay_separate(self):
        policy = {**POLICY, 'repeat_policy': 'best_grade', 'separate_course_patterns': [r'^[A-Z]{2,4} [234]99\b']}
        rows = [attempt('f', 'ZZ 100', grade='F', status='failed', term_id='2024-25-I'), attempt('a', 'ZZ 100', grade='A', term_id='2024-25-II'),
                attempt('p1', 'ZZ 299', grade='B', term_id='2024-25-I'), attempt('p2', 'ZZ 299', grade='A', term_id='2024-25-II'),
                attempt('v', 'ZZ 242(N)', grade='C', term_id='2024-25-I'), attempt('w', 'ZZ 242', grade='B', term_id='2024-25-II')]
        result = calculate_performance(rows, policy, identity={'ZZ 242(N)': 'ZZ 242', 'ZZ 242': 'ZZ 242'})
        cumulative = result['cumulative']
        # Counted: ZZ 100 A (40), ZZ 299 B (32) and A (40), ZZ 242 B (32) = 144 over 16.
        self.assertEqual((cumulative['grade_points'], cumulative['performance_credits']), ('144', '16'))
        self.assertEqual(sorted(e['attempt_id'] for e in cumulative['excluded_attempts'] if e['reason'] == 'SUPERSEDED_REPEAT'), ['f', 'v'])
        self.assertNotIn('REPEAT_POLICY_UNKNOWN', [i['code'] for i in result['issues']])
        # Historical SPI keeps the failed attempt in its own term (academic-decisions "Still open": unchanged).
        first = next(t for t in result['terms'] if t['term_id'] == '2024-25-I')
        self.assertIn('f', [c['attempt_id'] for c in first['contributing_attempts']])


class SpiCapTests(unittest.TestCase):
    """CR-110 item 1 / D-47: the shipped grading policy caps SPI at 10, like CPI."""

    @staticmethod
    def shipped_policy():
        from pathlib import Path
        import json
        return json.loads((Path(__file__).resolve().parents[2] / 'data' / 'grading' / 'reported-v1.json').read_text(encoding='utf-8'))

    def test_cp16_a_term_of_all_a_plus_shows_spi_10_not_11(self):
        policy = self.shipped_policy()
        result = calculate_performance([attempt('a', 'ZZ 100', '4', grade='A+'), attempt('b', 'ZZ 200', '4', grade='A+')], policy)
        self.assertEqual(result['terms'][0]['display_value'], '10.00')
        self.assertEqual(result['cumulative']['display_value'], '10.00')

    def test_cp16_the_cap_does_not_change_a_term_below_ten(self):
        # Negative: a cap applied too early (or to the points) would move this 8.67 term.
        policy = self.shipped_policy()
        result = calculate_performance([attempt('a', 'ZZ 100', '2', grade='A'), attempt('b', 'ZZ 200', '4', grade='B')], policy)
        self.assertEqual(result['terms'][0]['display_value'], '8.67')
