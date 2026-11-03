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
from coursepath.internships import evaluate_internship
from coursepath.prerequisites import load_recommended_prerequisites
from coursepath.rules.loader import load_curriculum
from coursepath.semester_plan import validate_plan
from tests.domain.test_audit import attempt
from tests.domain.test_internships import CALENDAR

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

    def test_cp22_old_codes_find_the_current_course_recommendation(self):
        # D-04: CS 433 is CS 331, CS 301 is CS 330, ES 413 is ES 667 and ES 215 is ES 336; the team list names current codes.
        result = validate_plan({**self.context, 'attempts': []}, plan('CS 433', 'CS 301', 'ES 413', 'ES 215'))
        missing = {row['id']: (row['eligibility'], row['prerequisite_proof']['missing']) for row in result['per_course']}
        self.assertEqual(missing, {'CS 433': ('ineligible', ['ES 242']), 'CS 301': ('ineligible', ['ES 242']),
                                   'ES 413': ('ineligible', ['ES 335']), 'ES 215': ('ineligible', ['ES 204'])})
        self.assertNotIn('PREREQUISITE_UNKNOWN', [i['code'] for i in result['issues']])
        satisfied = validate_plan({**self.context, 'attempts': [attempt('a', 'ES 242(N)')]}, plan('CS 433'))
        self.assertEqual(satisfied['per_course'][0]['eligibility'], 'eligible')

    def test_cp22_internship_downstream_check_finds_the_current_course_recommendation(self):
        # CS 433 is CS 331, which the team list prepares with ES 242; dropping ES 242 leaves CS 433 unprepared.
        semesters = [{'term_id': '2027-28-I', 'courses': [{'id': 'dsa', 'normalized_code': 'ES 242', 'credits': '4'}]},
                     {'term_id': '2027-28-II', 'courses': [{'id': 'net', 'normalized_code': 'CS 433', 'credits': '4'}]}]
        away = {'id': 'i', 'duration_choice': 'six_months', 'preset': 'custom', 'start_date': '2027-07-01', 'end_date_exclusive': '2028-01-01',
                'placement_mode': 'onsite_full_time', 'modules': []}
        result = evaluate_internship({**self.context, 'attempts': [], 'approvals': []}, away, {'id': 'p', 'semesters': semesters}, CALENDAR)
        self.assertEqual((result['affected_courses'], result['downstream_courses']), (['dsa'], ['net']))

    def test_cp22_repeat_checks_compare_resolved_identities(self):
        def repeats(first, second, attempts=()):
            semesters = [{'term_id': '2026-27-I', 'courses': [{'id': 'a', 'normalized_code': first, 'credits': '4'}]}] if first else []
            semesters.append({'term_id': '2026-27-II', 'courses': [{'id': 'b', 'normalized_code': second, 'credits': '4'}]})
            result = validate_plan({**self.context, 'attempts': list(attempts)}, {'semesters': semesters})
            return [(i['code'], i['entity_refs']) for i in result['issues'] if i['code'] in {'REPEAT_POLICY_UNKNOWN', 'DUPLICATE_COURSE'}]
        # Planned twice: ES 242(N) after ES 242 is the same course (D-04), just like ES 242 twice.
        self.assertEqual(repeats('ES 242', 'ES 242'), [('REPEAT_POLICY_UNKNOWN', ['b'])])
        self.assertEqual(repeats('ES 242', 'ES 242(N)'), [('REPEAT_POLICY_UNKNOWN', ['b'])])
        self.assertEqual(repeats('ES 242', 'ES 301'), [])
        # Against completed history: a passed old ES 242 makes a planned ES 242(N) a repeat; CS 203 never repeats CS 202 (D-03).
        self.assertEqual(repeats(None, 'ES 242(N)', [attempt('old', 'ES 242', credits='3')]), [('REPEAT_POLICY_UNKNOWN', ['b'])])
        self.assertEqual(repeats(None, 'CS 202', [attempt('tools', 'CS 203')]), [])

    def test_cp22_a_planned_variant_counts_as_earlier_preparation(self):
        semesters = [{'term_id': '2026-27-I', 'courses': [{'id': 'dsa', 'normalized_code': 'ES 242(N)', 'credits': '4'}]},
                     {'term_id': '2026-27-II', 'courses': [{'id': 'net', 'normalized_code': 'CS 331', 'credits': '4'}]}]
        result = validate_plan({**self.context, 'attempts': []}, {'semesters': semesters})
        rows = {row['id']: row for row in result['per_course']}
        self.assertEqual((rows['net']['eligibility'], rows['net']['prerequisite_proof']['proof']), ('conditional', ['dsa']))

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
