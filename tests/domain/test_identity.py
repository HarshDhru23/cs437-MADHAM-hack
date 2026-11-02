"""Course identity groups (docs/academic-decisions.md D-01 to D-04).

Expected matches come from the D-04 table: ES 242(N) is DSA I (ES 242),
CS 301 is Operating Systems (CS 330), and partial title matches such as
ES 417 / ES 668 are not merged. CS 203 is not CS 202 (D-03).
"""
from copy import deepcopy
import unittest
from coursepath.degree_audit import evaluate_audit
from coursepath.eligibility import evaluate_prerequisite
from coursepath.identity import identity_map, canonical_code
from coursepath.rules.loader import load_curriculum, validate_curriculum
from coursepath.semester_plan import validate_plan
from tests.domain.test_audit import attempt


def find(tree, requirement_id):
    for node in tree:
        if node['id'] == requirement_id:
            return node
        found = find(node.get('children', []), requirement_id)
        if found:
            return found


class CourseIdentityTests(unittest.TestCase):
    def test_cp13_d04_groups_map_old_and_variant_codes_to_the_current_course(self):
        mapping = identity_map(load_curriculum()['identity_groups'])
        for raw, current in [('ES 242(N)', 'ES 242'), ('ES 242', 'ES 242'), ('CS 301', 'CS 330'), ('CS 433', 'CS 331'), ('ES 654', 'ES 335'),
                             ('ES 678', 'ES 335'), ('CS 322', 'ES 214'), ('CS 621', 'CS 333')]:
            self.assertEqual(canonical_code(raw, mapping), current, raw)
        for separate in ['CS 203', 'ES 417', 'CS 429', 'CS 691-XII', 'CS 691-IV']:
            self.assertEqual(canonical_code(separate, mapping), separate)

    def test_cp17_variant_satisfies_core_while_cs203_stays_a_different_course(self):
        record = {'attempts': [attempt('dsa', 'ES 242(N)'), attempt('tools', 'CS 203'), attempt('os', 'CS 301', credits='5')]}
        before = deepcopy(record)
        audit = evaluate_audit(load_curriculum(), {}, record)
        self.assertEqual(record, before)  # the raw code stays as imported
        self.assertEqual(find(audit['actual'], 'dsa')['remaining_credits'], '0')
        self.assertEqual(find(audit['actual'], 'os')['counted_credits'], '5')  # D-02: the credits actually taken
        self.assertEqual(find(audit['actual'], 'tools')['remaining_credits'], '4')
        counted = {a['attempt_id']: a['requirement_id'] for a in audit['ledger']}
        self.assertEqual((counted.get('dsa'), counted.get('os')), ('dsa', 'os'))
        self.assertNotEqual(counted.get('tools'), 'tools')

    def test_cp22_prerequisites_compare_resolved_identities(self):
        mapping = identity_map(load_curriculum()['identity_groups'])
        rule = {'type': 'course', 'course_id': 'ES 242'}
        variant = [attempt('a', 'ES 242(N)')]
        self.assertEqual(evaluate_prerequisite(rule, '2025-26-I', variant)['status'], 'ineligible')
        self.assertEqual(evaluate_prerequisite(rule, '2025-26-I', variant, identity=mapping)['status'], 'eligible')
        self.assertEqual(evaluate_prerequisite({'type': 'course', 'course_id': 'CS 202'}, '2025-26-I', [attempt('b', 'CS 203')], identity=mapping)['status'], 'ineligible')
        catalogue = {'CS 330': {'prerequisite_known': True, 'prerequisites': rule}}
        plan = {'semesters': [{'term_id': '2026-27-I', 'courses': [{'id': 'p', 'normalized_code': 'CS 330', 'credits': '4'}]}]}
        result = validate_plan({'attempts': variant, 'catalogue': catalogue, 'identity': mapping}, plan)
        self.assertEqual(result['per_course'][0]['eligibility'], 'eligible')

    def test_cp19_identity_groups_are_sourced_and_never_overlap(self):
        curriculum = load_curriculum()
        self.assertTrue(all(g.get('decision') and g.get('source_refs') for g in curriculum['identity_groups']))
        for broken in [[{'current': 'ES 242', 'same': ['ES 242(N)'], 'decision': 'D-04', 'source_refs': ['academic-decisions']},
                        {'current': 'CS 330', 'same': ['ES 242(N)'], 'decision': 'D-04', 'source_refs': ['academic-decisions']}],
                       [{'current': 'ES 242', 'same': ['ES 242(N)'], 'decision': 'D-04', 'source_refs': ['nowhere']}],
                       [{'current': 'CS 202', 'same': ['CS 203'], 'source_refs': ['academic-decisions']}]]:
            with self.assertRaises(ValueError):
                validate_curriculum({**curriculum, 'identity_groups': broken})


if __name__ == '__main__':
    unittest.main()
