"""CR-105 (CP-21): through the API, confirmed current enrolment counts in its own term's load, and the schema accepts the new workload field."""
import json
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))


def enrolled(count):
    return [{'id': f'ce{n}', 'normalized_code': f'ZZ {100 + n}', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True} for n in range(1, count + 1)]


class EnrolmentLoadTests(AccountAPIMixin, TestCase):
    def start(self, rows):
        self.client = Client()
        self.signup(self.client, 'enrolment-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts(), 'current_enrolment': rows})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']

    def check(self, codes):
        semesters = [{'term_id': '2026-27-I', 'courses': [{'id': f'p{n}', 'normalized_code': c, 'credits': '4'} for n, c in enumerate(codes)], 'placeholders': []}]
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def test_cp21_24_enrolled_and_8_planned_credits_in_one_term_is_over_the_limit(self):
        self.start(enrolled(6))
        result = self.check(['ZZ 301', 'ZZ 302'])
        self.assertIn('LOAD_LIMIT', [i['code'] for i in result['validation']['issues']])
        self.assertEqual(result['validation']['workload']['2026-27-I']['target_credits'], '32')
        self.assertEqual(result['load']['2026-27-I'], {'planned_credits': '32', 'limit_credits': '28', 'available_credits': '0'})
        self.assertFalse(result['status']['valid'])

    def test_cp21_the_same_plan_without_enrolment_stays_within_the_limit(self):
        # Negative: only the enrolment changes the answer.
        self.start([])
        result = self.check(['ZZ 301', 'ZZ 302'])
        self.assertNotIn('LOAD_LIMIT', [i['code'] for i in result['validation']['issues']])
        self.assertEqual(result['load']['2026-27-I']['available_credits'], '20')
