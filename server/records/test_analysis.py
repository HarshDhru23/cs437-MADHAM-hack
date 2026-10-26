from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin
from tests.imports.test_ims import TABLE
from jsonschema import Draft202012Validator, FormatChecker
from server.records.services import SCHEMA


class AnalysisAPITests(AccountAPIMixin, TestCase):
    def test_public_requirements_catalogue_and_owned_analysis(self):
        public = Client()
        curriculum = public.get('/api/v1/curricula/cse-2024')
        self.assertEqual(curriculum.status_code, 200)
        self.assertEqual(curriculum.json()['data']['total_credits'], '170')
        self.assertTrue(curriculum.json()['issues'])
        self.assertEqual(public.get('/api/v1/catalogue').status_code, 200)
        self.assertEqual(self.request(public, 'post', '/analysis', {'record_revision': 0}).status_code, 401)
        self.signup(public, 'analysis')
        analysis = self.request(public, 'post', '/analysis', {'record_revision': 0})
        self.assertEqual(analysis.status_code, 200, analysis.content)
        data = analysis.json()['data']
        self.assertFalse(data['audit']['complete'])
        self.assertIsNone(data['performance']['cumulative']['display_value'])
        self.assertEqual(data['record_revision'], 0)
        self.assertEqual(self.request(public, 'post', '/analysis', {'record_revision': 5}).status_code, 409)

    def test_published_schema_accepts_real_session_plan_record_and_analysis(self):
        self.signup(self.client, 'schema-client')
        responses = [self.client.get('/api/v1/session'), self.client.get('/api/v1/record'), self.client.get('/api/v1/catalogue'),
                     self.client.get('/api/v1/curricula/cse-2024'), self.request(self.client, 'post', '/plans', {'semesters': []}),
                     self.request(self.client, 'post', '/analysis', {'record_revision': 0})]
        validator = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
        for result in responses:
            errors = list(validator.iter_errors(result.json()))
            self.assertFalse(errors, 'Published schema must accept the actual endpoint response shape')

    def test_invalid_plan_never_saves_and_validation_uses_owned_revision(self):
        self.signup(self.client, 'planner')
        bad = {'semesters': [{'term_id': '2026-27-I', 'courses': [{'id': 'a', 'normalized_code': 'ZZ 100', 'credits': '-1'}]}]}
        self.assertEqual(self.request(self.client, 'post', '/plans', bad).status_code, 400)
        good = {'semesters': [{'term_id': '2026-27-I', 'courses': [{'id': 'a', 'normalized_code': 'ZZ 100', 'credits': '4'}], 'placeholders': []}]}
        saved = self.request(self.client, 'post', '/plans', good)
        self.assertEqual(saved.status_code, 201, saved.content)
        plan = saved.json()['data']
        validated = self.request(self.client, 'post', '/plans/' + plan['id'] + '/validate', {'record_revision': 0, 'plan_revision': 0})
        self.assertEqual(validated.status_code, 200)
        self.assertEqual(validated.json()['data']['meeting_check_status'], 'not_checked')
        self.assertEqual(validated.json()['data']['workload']['2026-27-I']['selected_credits'], '4')
        self.assertEqual(self.request(self.client, 'post', '/analysis', {'record_revision': 0, 'plan_id': plan['id'], 'plan_revision': 0}).status_code, 200)
