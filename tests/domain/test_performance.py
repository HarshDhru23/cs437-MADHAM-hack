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
