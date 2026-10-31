"""Recommended preparation (docs/academic-decisions.md D-17).

Prerequisites are CoursePath team recommendations from
data/prerequisites/cse-2024-recommended.json: an unmet one is a warning that
never blocks a plan, and a course without an entry stays unknown.
"""
import json
import tempfile
import unittest
from pathlib import Path
from coursepath.identity import identity_map
from coursepath.prerequisites import load_recommended_prerequisites
from coursepath.rules.loader import load_curriculum
from coursepath.semester_plan import validate_plan
from tests.domain.test_audit import attempt

ROOT = Path(__file__).resolve().parents[2]


def plan(*codes):
    return {'semesters': [{'term_id': '2026-27-I', 'courses': [{'id': code, 'normalized_code': code, 'credits': '4'} for code in codes]}]}


class RecommendedPrerequisiteTests(unittest.TestCase):
    def setUp(self):
        self.context = {'catalogue': load_recommended_prerequisites(), 'identity': identity_map(load_curriculum()['identity_groups'])}

    def test_cp05_unmet_recommendation_is_a_labelled_warning_that_never_blocks(self):
        self.assertEqual(self.context['catalogue']['CS 331']['prerequisites']['course_id'], 'ES 242')
        result = validate_plan({**self.context, 'attempts': []}, plan('CS 331'))
        missing = [i for i in result['issues'] if i['code'] == 'PREREQUISITE_MISSING']
        self.assertEqual([(i['severity'], i['entity_refs']) for i in missing], [('warning', ['CS 331'])])
        self.assertIn('Recommended preparation (CoursePath team)', missing[0]['message'])
        self.assertIn('team-recommendation', missing[0]['source_refs'])
        self.assertFalse([i for i in result['issues'] if i['code'].startswith('PREREQUISITE') and i['severity'] == 'error'])

    def test_cp22_variant_satisfies_and_unlisted_course_stays_unknown(self):
        satisfied = validate_plan({**self.context, 'attempts': [attempt('a', 'ES 242(N)')]}, plan('CS 331'))
        self.assertEqual(satisfied['per_course'][0]['eligibility'], 'eligible')
        unlisted = validate_plan({**self.context, 'attempts': []}, plan('HS 151'))
        self.assertEqual(unlisted['per_course'][0]['eligibility'], 'unknown')
        unknown = [i for i in unlisted['issues'] if i['code'] == 'PREREQUISITE_UNKNOWN']
        self.assertEqual(unknown[0]['severity'], 'unknown')
        self.assertIn('No recommendation recorded', unknown[0]['message'])

    def test_cp22_loader_rejects_duplicate_or_malformed_entries(self):
        data = json.loads((ROOT / 'data/prerequisites/cse-2024-recommended.json').read_text())
        for broken in [{**data, 'courses': data['courses'] + data['courses'][:1]},
                       {**data, 'courses': [{**data['courses'][0], 'expression': {'type': 'maybe'}}]},
                       {**data, 'cohort': 'BTECH_EE-2024'},
                       {**data, 'severity': 'error'}]:
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'broken.json'
                path.write_text(json.dumps(broken))
                with self.assertRaises(ValueError):
                    load_recommended_prerequisites(path)


if __name__ == '__main__':
    unittest.main()
