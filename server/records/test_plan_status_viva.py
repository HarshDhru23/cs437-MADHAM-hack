"""CR-104 (D-16, D-45, CP-36): a plan is not valid while a zero-credit requirement, such as the comprehensive viva (a P in every active
semester), is still incomplete on the record. Record: tests/plan_fixtures.synthetic_attempts, whose four active semesters each carry an IN record."""
import json
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))
VIVA = ('IN 101', 'IN 102', 'IN 103', 'IN 104')


class VivaPlanStatusTests(AccountAPIMixin, TestCase):
    def start(self, without=()):
        self.client = Client()
        self.signup(self.client, 'viva-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts(without=without)})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']
        generated = self.request(self.client, 'post', '/plans/generate', {'record_revision': self.revision})
        self.assertEqual(generated.status_code, 200, generated.content)
        self.semesters = generated.json()['data']['semesters']

    def check(self):
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': self.semesters})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def test_cp36_a_plan_is_not_valid_while_the_viva_is_missing_and_says_so(self):
        self.start(without=VIVA)
        result = self.check()
        self.assertEqual(result['uncovered_credits'], '0', 'the generated plan covers every credit; only the viva is missing')
        self.assertFalse(result['status']['valid'], result['status'])
        self.assertGreaterEqual(result['status']['problems'], 1)
        pending = [i for i in result['validation']['issues'] if 'viva' in i['message'].lower()]
        self.assertEqual(len(pending), 1, result['validation']['issues'])
        self.assertEqual(pending[0]['severity'], 'error')
        self.assertEqual(sorted(pending[0]['entity_refs']), ['2024-25-I', '2024-25-II', '2025-26-I', '2025-26-II'])

    def test_cp36_one_missing_viva_semester_is_enough_to_make_the_plan_not_valid(self):
        self.start(without=('IN 104',))
        result = self.check()
        self.assertFalse(result['status']['valid'], result['status'])
        pending = [i for i in result['validation']['issues'] if 'viva' in i['message'].lower()]
        self.assertEqual([i['entity_refs'] for i in pending], [['2025-26-II']])

    def test_cp36_a_record_with_every_viva_keeps_a_valid_plan_valid(self):
        # Negative: the new check must not flag a record whose active semesters all have their viva.
        self.start()
        result = self.check()
        self.assertEqual(result['status'], {'valid': True, 'problems': 0, 'uncovered_credits': '0'})
        self.assertFalse([i for i in result['validation']['issues'] if 'viva' in i['message'].lower()])

    def test_cp36_a_saved_plan_is_not_valid_in_the_list_either(self):
        self.start(without=VIVA)
        saved = self.request(self.client, 'post', '/plans', {'semesters': self.semesters, 'label': 'Main'})
        self.assertEqual(saved.status_code, 201, saved.content)
        self.assertFalse(saved.json()['data']['status']['valid'])
        listed = self.client.get('/api/v1/plans').json()['data']
        self.assertEqual([p['status']['valid'] for p in listed], [False])
