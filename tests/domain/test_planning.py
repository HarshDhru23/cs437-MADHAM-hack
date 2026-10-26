from copy import deepcopy
import unittest
from coursepath.eligibility import evaluate_prerequisite
from coursepath.semester_plan import validate_plan, edit_semester_plan
from tests.domain.test_audit import attempt


class PlanningTests(unittest.TestCase):
    def test_cp22_nested_truth_table_unknown_and_empty(self):
        leaf = {'type': 'course', 'course_id': 'ZZ 100'}
        other = {'type': 'course', 'course_id': 'ZZ 200'}
        expression = {'type': 'and', 'children': [leaf, {'type': 'or', 'children': [other, {'type': 'course', 'course_id': 'ZZ 300'}]}]}
        self.assertEqual(evaluate_prerequisite(expression, '2025-26-I', [attempt('a', 'ZZ 100'), attempt('b', 'ZZ 300')])['status'], 'eligible')
        self.assertEqual(evaluate_prerequisite(expression, '2025-26-I', [attempt('a', 'ZZ 100')])['missing'], ['ZZ 200'])
        self.assertEqual(evaluate_prerequisite(None, '2025-26-I', [])['status'], 'unknown')
        self.assertEqual(evaluate_prerequisite({'type': 'and', 'children': []}, '2025-26-I', [])['status'], 'eligible')

    def test_cp05_ordering_exposure_corequisite_and_min_grade(self):
        rule = {'type': 'course', 'course_id': 'ZZ 100'}
        failed = attempt('a', 'ZZ 100', status='failed', grade='E')
        self.assertEqual(evaluate_prerequisite(rule, '2025-26-I', [failed])['status'], 'ineligible')
        self.assertEqual(evaluate_prerequisite({**rule, 'allow_exposure_grades': ['E']}, '2025-26-I', [failed])['status'], 'eligible')
        self.assertEqual(evaluate_prerequisite({**rule, 'minimum_grade': 'A'}, '2025-26-I', [attempt('a', 'ZZ 100', grade='B')])['status'], 'ineligible')
        for term, expected in [('2024-25-II', 'conditional'), ('2025-26-I', 'ineligible'), ('2025-26-II', 'ineligible')]:
            self.assertEqual(evaluate_prerequisite(rule, '2025-26-I', [], [{'normalized_code': 'ZZ 100', 'term_id': term}])['status'], expected)
        self.assertEqual(evaluate_prerequisite({**rule, 'co_requisite': True}, '2025-26-I', [], [{'normalized_code': 'ZZ 100', 'term_id': '2025-26-I'}])['status'], 'conditional')

    def test_cp21_load_boundaries_and_cpi_never_approves(self):
        for credits, context, term, code in [
            ('28', {'standing': 'normal'}, '2026-27-I', None), ('29', {'standing': 'normal', 'cpi': '9'}, '2026-27-I', 'OVERLOAD_APPROVAL_REQUIRED'),
            ('33', {'standing': 'normal'}, '2026-27-I', 'LOAD_LIMIT'), ('22', {'standing': 'GPS'}, '2026-27-I', 'LOAD_LIMIT'),
            ('11', {'standing': 'normal'}, '2026-27-SUMMER', 'LOAD_LIMIT'), ('25', {'standing': 'normal', 'advisor_cap': '24'}, '2026-27-I', 'LOAD_LIMIT')]:
            plan = {'semesters': [{'term_id': term, 'courses': [{'id': 'p', 'normalized_code': 'ZZ 100', 'credits': credits}]}]}
            result = validate_plan(context, plan)
            codes = [i['code'] for i in result['issues']]
            if code:
                self.assertIn(code, codes)
            else:
                self.assertNotIn('LOAD_LIMIT', codes)
                self.assertNotIn('OVERLOAD_APPROVAL_REQUIRED', codes)

    def test_cp04_move_revalidates_downstream_and_placeholders_separate(self):
        catalogue = {'ZZ 200': {'prerequisite_known': True, 'prerequisites': {'type': 'course', 'course_id': 'ZZ 100'}}}
        plan = {'semesters': [
            {'term_id': '2025-26-I', 'semester_id': 3, 'courses': [{'id': 'a', 'course_id': 'ZZ 100', 'normalized_code': 'ZZ 100', 'credits': '4'}]},
            {'term_id': '2025-26-II', 'semester_id': 4, 'courses': [{'id': 'b', 'course_id': 'ZZ 200', 'normalized_code': 'ZZ 200', 'credits': '4'}], 'placeholders': [{'id': 'hss', 'desired_credits': '2'}]}]}
        before = deepcopy(plan)
        self.assertEqual(validate_plan({'catalogue': catalogue}, plan)['workload']['2025-26-II']['placeholder_credits'], '2')
        dropped = edit_semester_plan(plan, 3, remove_course_ids=['ZZ 100'])
        self.assertTrue(any(i['code'] == 'PREREQUISITE_MISSING' and 'b' in i['entity_refs'] for i in validate_plan({'catalogue': catalogue}, dropped)['issues']))
        self.assertEqual(plan, before)
