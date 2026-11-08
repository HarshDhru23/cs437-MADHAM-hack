"""D-45 (CP-36): a plan is valid when its check finds no error and no degree requirement is left uncovered; a plan that is not valid can still be saved."""
import json
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))


class PlanStatusAPITests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'status-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']
        generated = self.request(self.client, 'post', '/plans/generate', {'record_revision': self.revision}).json()['data']
        self.semesters = generated['semesters']
        self.complete = generated['summary']['complete']

    def check(self, semesters):
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def test_cp36_a_plan_that_covers_every_remaining_requirement_is_valid(self):
        self.assertTrue(self.complete, 'the synthetic record has a complete generated plan (hand-counted in tests/plan_fixtures.py)')
        status = self.check(self.semesters)['status']
        self.assertEqual(status, {'valid': True, 'problems': 0, 'uncovered_credits': '0'})

    def test_cp36_removing_a_course_leaves_credits_uncovered_and_the_plan_not_valid(self):
        trimmed = json.loads(json.dumps(self.semesters))
        victim = next(c for s in trimmed for c in s['courses'] if c['credits'] not in ('0',))
        for s in trimmed:
            s['courses'] = [c for c in s['courses'] if c['id'] != victim['id']]
        result = self.check(trimmed)
        self.assertFalse(result['status']['valid'])
        self.assertEqual(result['status']['problems'], 0)  # nothing is wrong with the plan itself; it just does not cover the degree
        self.assertEqual(result['status']['uncovered_credits'], result['uncovered_credits'])
        self.assertGreaterEqual(float(result['status']['uncovered_credits']), float(victim['credits']))

    def test_cp36_an_error_makes_the_plan_not_valid_even_when_nothing_is_uncovered(self):
        crowded = json.loads(json.dumps(self.semesters))
        crowded[0]['placeholders'].append({'id': 'user-overload', 'requirement_id': crowded[0]['placeholders'][0]['requirement_id'] if crowded[0]['placeholders'] else 'open-electives',
                                           'desired_credits': '30', 'label': 'Overload'})
        status = self.check(crowded)['status']
        self.assertGreaterEqual(status['problems'], 1)
        self.assertFalse(status['valid'])

    def test_cp36_a_plan_that_is_not_valid_is_still_saved_and_listed_with_its_status(self):
        trimmed = json.loads(json.dumps(self.semesters))
        for s in trimmed:
            s['courses'] = s['courses'][:1]
        created = self.request(self.client, 'post', '/plans', {'label': 'Thin plan', 'semesters': trimmed})
        self.assertEqual(created.status_code, 201, created.content)
        self.assertFalse(created.json()['data']['status']['valid'])
        good = self.request(self.client, 'post', '/plans', {'label': 'Full plan', 'semesters': self.semesters})
        self.assertEqual(good.status_code, 201, good.content)
        listed = self.client.get('/api/v1/plans')
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(listed.json())
        by_label = {p['label']: p['status']['valid'] for p in listed.json()['data']}
        self.assertEqual(by_label, {'Thin plan': False, 'Full plan': True})

    def test_cp36_the_status_follows_the_record_not_the_moment_of_saving(self):
        created = self.request(self.client, 'post', '/plans', {'label': 'Full plan', 'semesters': self.semesters}).json()['data']
        self.assertTrue(created['status']['valid'])
        record = self.client.get('/api/v1/record').json()['data']
        # A course the plan relies on is now on the record with a fail grade: nothing about the plan changed, but it no longer covers the degree.
        failing = [a for a in record['attempts'] if a['completion_status'] == 'completed' and a['credits'] not in ('0',)][0]
        failing['grade'] = 'F'
        failing['completion_status'] = 'failed'
        patched = self.request(self.client, 'patch', '/record', {'expected_revision': record['revision'], 'attempts': record['attempts'],
                                                                  'correction_justifications': {failing['id']: 'Synthetic: the grade was entered wrongly'}})
        self.assertEqual(patched.status_code, 200, patched.content)
        listed = self.client.get('/api/v1/plans').json()['data']
        self.assertFalse(listed[0]['status']['valid'])
