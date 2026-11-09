"""A scenario's downstream list includes a course whose recommended-preparation warning gets worse (issue #14; CP-28, D-17).

Expectations come from the committed team recommendations (data/prerequisites/cse-2024-recommended.json):
CS 329 recommends ES 242 and ES 114, CS 330 recommends ES 242, CS 328 recommends ES 114.
"""
import json
import unittest
from pathlib import Path
from coursepath.prerequisites import load_recommended_prerequisites
from coursepath.rules.loader import load_curriculum
from coursepath.scenarios import compare_scenario

ROOT = Path(__file__).resolve().parents[2]


def planned(item_id, code):
    return {'id': item_id, 'normalized_code': code, 'credits': '4', 'learning_designation': 'degree'}


class ScenarioDownstreamTests(unittest.TestCase):
    def compare(self, *changes):
        context = {'curriculum': load_curriculum(), 'catalogue': load_recommended_prerequisites(), 'standing': 'regular',
                   'grading_policy': json.loads((ROOT / 'data/grading/reported-v1.json').read_text())}
        # The record is empty, so ES 114 is missing for CS 329 and CS 328 already in the baseline.
        baseline = {'record': {'revision': 1, 'attempts': [], 'current_enrolment': []}, 'rule_version': 'v',
                    'plan': {'id': 'p', 'revision': 1, 'semesters': [
                        {'term_id': '2026-27-I', 'courses': [planned('dsa', 'ES 242')]},
                        {'term_id': '2027-28-I', 'courses': [planned('mas', 'CS 329'), planned('os', 'CS 330'), planned('ds', 'CS 328')]}]}}
        scenario = {'id': 's', 'baseline_record_revision': 1, 'baseline_plan_revision': 1, 'rule_version': 'v', 'changes': list(changes)}
        return compare_scenario(context, baseline, scenario)['deltas']['downstream_affected']

    def test_cp28_a_worsened_prerequisite_warning_is_downstream(self):
        # Dropping ES 242: CS 329 goes from missing {ES 114} to {ES 114, ES 242} (worse); CS 330 from none to {ES 242} (new).
        # Negative: CS 328 stays missing {ES 114}, unchanged, so it is not listed.
        self.assertEqual(self.compare({'op': 'drop', 'item_id': 'dsa'}), ['mas', 'os'])

    def test_cp28_unchanged_warnings_are_not_downstream(self):
        # Dropping CS 328 removes no preparation: CS 329 still misses only {ES 114}, as in the baseline, so nothing is listed
        # (listing every course that still has a warning would wrongly give ['mas']).
        self.assertEqual(self.compare({'op': 'drop', 'item_id': 'ds'}), [])
