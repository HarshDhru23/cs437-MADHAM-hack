"""H13 what-if scenarios (CP-28) and the plan-only apply path.

Expectations follow roadmap section 5 "What-if scenarios" and contracts
section 6: the baseline never changes, hypothetical grades are labelled,
downstream effects are reported, and applying a scenario writes plan edits only.
"""
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import unittest
from coursepath.rules.loader import load_curriculum
from coursepath.scenarios import compare_scenario, plan_edits
from tests.domain.test_internships import CALENDAR, module

ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = {'ZZ 200': {'prerequisite_known': True, 'prerequisites': {'type': 'course', 'course_id': 'ZZ 100'}}}


def history(attempt_id, code, grade, term):
    return {'id': attempt_id, 'normalized_code': code, 'original_code': code, 'title': 'Synthetic', 'credits': '4', 'grade': grade,
            'term_id': term, 'completion_status': 'completed', 'learning_designation': 'degree', 'source_refs': [], 'user_corrections': []}


def planned(item_id, code):
    # The domain counts a planned course only when it is declared degree learning.
    return {'id': item_id, 'normalized_code': code, 'credits': '4', 'learning_designation': 'degree'}


def baseline():
    record = {'revision': 4, 'attempts': [history('h1', 'ES 242', 'A', '2024-25-II'), history('h2', 'ES 214', 'B', '2025-26-I')], 'current_enrolment': []}
    plan = {'id': 'plan-1', 'revision': 2, 'semesters': [
        {'term_id': '2026-27-I', 'courses': [planned('os', 'CS 330'), planned('pre', 'ZZ 100'), planned('net', 'CS 331')]},
        {'term_id': '2026-27-II', 'courses': [planned('dep', 'ZZ 200')]},
        {'term_id': '2027-28-I', 'courses': []}]}
    return {'record': record, 'plan': plan, 'rule_version': 'cse-2024-draft-v1'}


def context():
    policy = json.loads((ROOT / 'data/grading/reported-v1.json').read_text())
    return {'curriculum': load_curriculum(), 'catalogue': CATALOGUE, 'grading_policy': policy, 'standing': 'normal', 'calendar': CALENDAR}


def scenario(*changes, **extra):
    return {'id': 'sc-1', 'baseline_record_revision': 4, 'baseline_plan_revision': 2, 'rule_version': 'cse-2024-draft-v1', 'changes': list(changes), **extra}


def checksum(*values):
    return json.dumps(values, sort_keys=True, default=str)


def find(tree, requirement_id):
    for node in tree:
        if node['id'] == requirement_id:
            return node
        found = find(node.get('children', []), requirement_id)
        if found:
            return found


class ScenarioTests(unittest.TestCase):
    def test_cp28_drop_reports_downstream_without_touching_the_baseline(self):
        base, ctx = baseline(), context()
        before = checksum(base, ctx)
        result = compare_scenario(ctx, base, scenario({'op': 'drop', 'item_id': 'pre'}))
        self.assertEqual(checksum(base, ctx), before)
        self.assertFalse(result['stale'])
        self.assertEqual(result['deltas']['downstream_affected'], ['dep'])
        self.assertIn('PREREQUISITE_MISSING', [i['code'] for i in result['deltas']['new_issues']])
        self.assertEqual(result['deltas']['workload']['2026-27-I'], {'baseline': '12', 'scenario': '8'})
        self.assertIsNone(result['scenario']['completion_term'])

    def test_cp28_hypothetical_failure_changes_projection_and_labelled_cpi_only(self):
        base = baseline()
        result = compare_scenario(context(), base, scenario({'op': 'fail', 'item_id': 'os'}))
        self.assertEqual(result['baseline']['audit']['actual'], result['scenario']['audit']['actual'])
        # The committed curriculum is draft, so statuses stay needs_review; the counted credits move.
        self.assertEqual(find(result['baseline']['audit']['projected'], 'os')['remaining_credits'], '0')
        self.assertEqual(find(result['scenario']['audit']['projected'], 'os')['remaining_credits'], '4')
        self.assertIn('os', [d['id'] for d in result['deltas']['requirements']])
        performance = result['scenario']['performance']
        self.assertTrue(performance['hypothetical'])
        self.assertFalse(result['baseline']['performance']['hypothetical'])
        # (4*10 + 4*8) / 8 = 9 actually; with a hypothetical F on 4 credits: 72 / 12 = 6.
        self.assertEqual(result['baseline']['performance']['cumulative']['unrounded_value'], '9')
        self.assertEqual(performance['cumulative']['unrounded_value'], '6')
        self.assertEqual(base['record']['attempts'], baseline()['record']['attempts'])

    def test_cp28_postpone_replace_and_cap_rerun_the_same_checks(self):
        postponed = compare_scenario(context(), baseline(), scenario({'op': 'postpone', 'item_id': 'pre', 'term_id': '2027-28-I'}))
        self.assertEqual(postponed['deltas']['downstream_affected'], ['dep'])
        self.assertEqual(postponed['deltas']['workload']['2027-28-I'], {'baseline': '0', 'scenario': '4'})
        with self.assertRaises(ValueError):
            compare_scenario(context(), baseline(), scenario({'op': 'postpone', 'item_id': 'dep', 'term_id': '2026-27-I'}))
        replaced = compare_scenario(context(), baseline(), scenario({'op': 'replace', 'item_id': 'net', 'course': {'normalized_code': 'CS 432', 'credits': '4'}}))
        self.assertEqual(find(replaced['scenario']['audit']['projected'], 'networks')['remaining_credits'], '4')
        capped = compare_scenario(context(), baseline(), scenario({'op': 'cap', 'term_id': '2026-27-I', 'credits': '8'}))
        self.assertIn(('LOAD_LIMIT', ('2026-27-I',)), [(i['code'], tuple(i['entity_refs'])) for i in capped['deltas']['new_issues']])
        for bad in [{'op': 'teleport', 'item_id': 'os'}, {'op': 'drop', 'item_id': 'missing'}, {'op': 'grade', 'item_id': 'os', 'grade': 'Z'}]:
            with self.assertRaises(ValueError):
                compare_scenario(context(), baseline(), scenario(bad))

    def test_cp28_stale_scenario_needs_rebase_before_any_comparison(self):
        base = baseline()
        base['record']['revision'] = 5
        result = compare_scenario(context(), base, scenario({'op': 'drop', 'item_id': 'pre'}))
        self.assertTrue(result['stale'])
        self.assertIsNone(result['deltas'])
        self.assertEqual([i['code'] for i in result['issues']], ['SCENARIO_STALE'])

    def test_cp28_hypothetical_grade_and_award_goal_are_labelled_not_certified(self):
        result = compare_scenario(context(), baseline(), scenario({'op': 'grade', 'item_id': 'os', 'grade': 'A'}, award_ids=['ai_minor']))
        # (40 + 32 + 40) / 12 = 9.3333...
        self.assertEqual(Decimal(result['scenario']['performance']['cumulative']['unrounded_value']).quantize(Decimal('0.000001')), Decimal('9.333333'))
        self.assertTrue(result['scenario']['performance']['hypothetical'])
        self.assertEqual(result['baseline']['audit']['actual'], result['scenario']['audit']['actual'])
        self.assertIn('AWARD_POLICY_MISSING', [i['code'] for i in result['scenario']['issues']])

    def test_cp33_scenario_internship_runs_through_the_same_comparison(self):
        internship = {'id': 'i6', 'duration_choice': 'six_months', 'start_date': '2027-07-01', 'end_date_exclusive': '2028-01-01',
                      'placement_mode': 'onsite_full_time', 'modules': [module('m1', 'open_elective')]}
        result = compare_scenario(context(), baseline(), scenario(internship=internship))
        self.assertIsNone(result['baseline']['internship'])
        self.assertEqual(result['scenario']['internship']['credits']['proposed'], '4')
        self.assertEqual(result['scenario']['internship']['credits']['approved'], '0')


class PlanApplyTests(unittest.TestCase):
    def test_cp28_apply_writes_plan_edits_only(self):
        plan = baseline()['plan']
        before = deepcopy(plan)
        edited, skipped = plan_edits(plan, scenario({'op': 'drop', 'item_id': 'pre'}, {'op': 'fail', 'item_id': 'os'},
                                                    {'op': 'grade', 'item_id': 'net', 'grade': 'A'}, {'op': 'postpone', 'item_id': 'dep', 'term_id': '2027-28-I'},
                                                    {'op': 'cap', 'term_id': '2026-27-I', 'credits': '8'}))
        self.assertEqual(plan, before)
        codes = {s['term_id']: [c['id'] for c in s['courses']] for s in edited['semesters']}
        self.assertEqual(codes, {'2026-27-I': ['os', 'net'], '2026-27-II': [], '2027-28-I': ['dep']})
        self.assertEqual(sorted(s['op'] for s in skipped), ['cap', 'fail', 'grade'])
        self.assertNotIn('id', edited)
        self.assertNotIn('revision', edited)


if __name__ == '__main__':
    unittest.main()
