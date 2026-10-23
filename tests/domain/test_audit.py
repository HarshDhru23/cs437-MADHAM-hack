from copy import deepcopy
from decimal import Decimal
import unittest
from coursepath.degree_audit import evaluate_audit
from tests.domain.test_rules import synthetic_curriculum


def attempt(id, code, credits='4', status='completed', **extra):
    return {'id': id, 'normalized_code': code, 'credits': credits, 'completion_status': status,
            'grade': 'A' if status == 'completed' else 'F', 'term_id': '2024-25-I',
            'learning_designation': 'degree', 'source_refs': ['synthetic'], **extra}


class AuditTests(unittest.TestCase):
    def test_cp17_adversarial_allocation_conservation_and_determinism(self):
        curriculum = synthetic_curriculum()
        rows = [attempt('a', 'ZZ 100'), attempt('b', 'ZZ 200')]
        result = evaluate_audit(curriculum, {}, {'attempts': rows})
        self.assertTrue(result['complete'])
        self.assertEqual({a['requirement_id']: a['attempt_id'] for a in result['ledger']}, {'narrow': 'a', 'flexible': 'b'})
        self.assertEqual(sum(Decimal(a['credits']) for a in result['ledger']), 8)
        self.assertEqual(result, evaluate_audit(curriculum, {}, {'attempts': list(reversed(rows))}))

    def test_cp20_failed_current_planned_unknown_and_budget(self):
        curriculum = synthetic_curriculum()
        for status in ['failed', 'in_progress', 'planned', 'unknown']:
            result = evaluate_audit(curriculum, {}, {'attempts': [attempt('a', 'ZZ 100', status=status)]})
            self.assertFalse(result['complete'])
            self.assertEqual(result['ledger'], [])
        exhausted = evaluate_audit(curriculum, {}, {'attempts': [attempt('a', 'ZZ 100'), attempt('b', 'ZZ 200')]}, node_budget=0)
        self.assertTrue(any(i['code'] == 'ALLOCATION_UNRESOLVED' for i in exhausted['issues']))
        self.assertFalse(exhausted['complete'])

    def test_cp18_caps_enforced_in_search_and_project_instances_survive(self):
        curriculum = synthetic_curriculum()
        curriculum['caps'] = [{'id': 'cap', 'maximum_credits': '4', 'tags_any': ['project'], 'source_refs': ['s']}]
        catalogue = {'ZZ 100': {'tags': ['project']}, 'ZZ 200': {'tags': ['project']}}
        result = evaluate_audit(curriculum, catalogue, {'attempts': [attempt('a', 'ZZ 100'), attempt('b', 'ZZ 200')]})
        self.assertFalse(result['complete'])
        self.assertEqual(sum(Decimal(a['credits']) for a in result['ledger']), 4)
        self.assertTrue(result['excluded_attempts'])

    def test_cp19_draft_never_certifies_and_parent_not_double_counted(self):
        curriculum = synthetic_curriculum()
        curriculum['requirements'] = [{'id': 'parent', 'type': 'all_of', 'minimum_credits': '8', 'source_refs': ['s'], 'children': curriculum['requirements']}]
        rows = [attempt('a', 'ZZ 100'), attempt('b', 'ZZ 200')]
        result = evaluate_audit(curriculum, {}, {'attempts': rows})
        self.assertEqual(result['actual'][0]['counted_credits'], '8')
        self.assertEqual(len(result['ledger']), 2)
        curriculum['review_status'] = 'draft'
        result = evaluate_audit(curriculum, {}, {'attempts': rows})
        self.assertFalse(result['complete'])
        self.assertEqual(result['actual'][0]['status'], 'needs_review')

    def test_any_of_and_course_count_use_indivisible_instances(self):
        curriculum = synthetic_curriculum()
        curriculum['total_credits'] = '4'
        curriculum['requirements'] = [{'id': 'either', 'type': 'any_of', 'minimum_credits': '4', 'source_refs': ['s'], 'children': [
            {'id': 'a', 'type': 'mandatory_course', 'course_id': 'ZZ 100', 'minimum_credits': '4', 'source_refs': ['s']},
            {'id': 'b', 'type': 'choose_courses', 'course_ids': ['ZZ 200', 'ZZ 300'], 'minimum_courses': 2, 'minimum_credits': '4', 'source_refs': ['s']}]}]
        self.assertTrue(evaluate_audit(curriculum, {}, {'attempts': [attempt('a', 'ZZ 100')]})['complete'])
        self.assertFalse(evaluate_audit(curriculum, {}, {'attempts': [attempt('a', 'ZZ 200')]})['complete'])
        self.assertTrue(evaluate_audit(curriculum, {}, {'attempts': [attempt('a', 'ZZ 200', '2'), attempt('b', 'ZZ 300', '2')]})['complete'])

    def test_unknown_child_rolls_up_to_needs_review(self):
        curriculum = synthetic_curriculum()
        curriculum['requirements'][0]['course_ids'] = None
        curriculum['requirements'] = [{'id': 'parent', 'type': 'all_of', 'minimum_credits': '8', 'source_refs': ['s'], 'children': curriculum['requirements']}]
        result = evaluate_audit(curriculum, {}, {'attempts': [attempt('a', 'ZZ 100')]})
        self.assertEqual(result['actual'][0]['status'], 'needs_review')
