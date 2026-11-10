"""CP-38 through the API: `options.include_current` chooses between planning from the completed courses alone and from completed + current courses,
and the plan the first choice produces is checked like any other (the running semester's own courses are one course, never counted twice)."""
import json
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))
ENROLLED = [{'id': 'ce-330', 'normalized_code': 'CS 330', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True},
            {'id': 'ce-331', 'normalized_code': 'CS 331', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True}]


class IncludeCurrentTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'include-current-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts(), 'current_enrolment': ENROLLED})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']

    def generate(self, **options):
        response = self.request(self.client, 'post', '/plans/generate', {'record_revision': self.revision, **({'options': options} if options else {})})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def test_cp38_by_default_the_plan_starts_after_the_running_semester(self):
        data = self.generate()
        self.assertEqual(data['options']['terms'][0], '2026-27-II')
        self.assertTrue(data['options']['include_current'])

    def test_cp38_completed_only_plans_the_running_semester_again(self):
        data = self.generate(include_current=False)
        self.assertEqual(data['options']['terms'][0], '2026-27-I')
        self.assertFalse(data['options']['include_current'])
        self.assertEqual([i for i in data['validation']['issues'] if i['severity'] == 'error'], [])

    def test_cp38_include_current_must_be_a_boolean(self):
        response = self.request(self.client, 'post', '/plans/generate', {'record_revision': self.revision, 'options': {'include_current': 'no'}})
        self.assertEqual(response.status_code, 400)

    def test_cp38_a_running_course_planned_again_is_one_course_in_the_degree_count(self):
        # Planning CS 330 and CS 331 in 2026-27-I while the record says they are being taken then must not count them twice.
        semesters = [{'term_id': '2026-27-I', 'courses': [{'id': 'p1', 'normalized_code': 'CS 330', 'credits': '4'}, {'id': 'p2', 'normalized_code': 'CS 331', 'credits': '4'}], 'placeholders': []}]
        both = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters}).json()['data']
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': self.revision, 'attempts': synthetic_attempts(), 'current_enrolment': []})
        alone = self.request(self.client, 'post', '/plans/check', {'record_revision': saved.json()['data']['revision'], 'semesters': semesters}).json()['data']
        self.assertEqual(both['degree']['counted_credits'], alone['degree']['counted_credits'])
        self.assertEqual(both['validation']['workload']['2026-27-I']['target_credits'], alone['validation']['workload']['2026-27-I']['target_credits'])
