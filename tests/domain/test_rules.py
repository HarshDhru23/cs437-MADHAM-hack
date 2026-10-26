from copy import deepcopy
from pathlib import Path
import json
import unittest
from coursepath.rules.loader import validate_curriculum

ROOT = Path(__file__).resolve().parents[2]


def synthetic_curriculum():
    return {'id': 'synthetic', 'version': 'synthetic-v1', 'cohort': 'BTECH_CSE-2024', 'review_status': 'reviewed',
            'sources': [{'id': 's', 'kind': 'advisory', 'locator': 'Synthetic section 1', 'version': 'v1',
                         'applicable_cohorts': ['BTECH_CSE-2024'], 'effective_date': '2024-01-01', 'review_status': 'reviewed', 'authority': 'institutional'}],
            'total_credits': '8', 'requirements': [
                {'id': 'flexible', 'type': 'minimum_credits', 'minimum_credits': '4', 'course_ids': ['ZZ 100', 'ZZ 200'], 'source_refs': ['s']},
                {'id': 'narrow', 'type': 'minimum_credits', 'minimum_credits': '4', 'course_ids': ['ZZ 100'], 'source_refs': ['s']}], 'caps': []}


class RuleTests(unittest.TestCase):
    def test_validation_rejects_duplicate_missing_source_wrong_cohort_and_minima(self):
        base = synthetic_curriculum()
        self.assertEqual(validate_curriculum(base), base)
        variants = []
        duplicate = deepcopy(base)
        duplicate['requirements'][1]['id'] = 'flexible'
        variants.append(duplicate)
        missing = deepcopy(base)
        missing['sources'][0]['locator'] = ''
        variants.append(missing)
        wrong = deepcopy(base)
        wrong['cohort'] = 'BTECH_CSE-2025'
        variants.append(wrong)
        bad = deepcopy(base)
        bad['requirements'][0]['minimum_credits'] = '20'
        variants.append(bad)
        for variant in variants:
            with self.subTest(variant=variant):
                with self.assertRaises(ValueError):
                    validate_curriculum(variant)

    def test_170_draft_baseline_honest_missing_source_and_obligations(self):
        path = ROOT / 'data/curricula/cse-2024.json'
        self.assertTrue(path.exists(), 'H06 should publish a traceable draft without fabricating source approval')
        curriculum = validate_curriculum(json.loads(path.read_text()))
        self.assertEqual(curriculum['review_status'], 'draft')
        self.assertEqual(curriculum['total_credits'], '170')
        self.assertEqual(len(curriculum['noncredit_obligations']), 2)
        self.assertTrue(curriculum['missing_sources'])
        self.assertNotIn('CS 203', json.dumps(curriculum['requirements']))
