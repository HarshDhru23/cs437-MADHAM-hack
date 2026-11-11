"""CP-47 through the API: a plan that holds more credits than the degree asks for reports the extra as `degree.surplus_credits`, and the numbers stay inside
the schema. Counted by hand on the sample student (tests/plan_fixtures.py: 92 of 170 credits, open electives 0 of 16): a plan of ten 4-credit courses no
other requirement takes puts 16 of those 40 credits into open electives, so 108 are counted and 24 are beyond what the degree asks for."""
import json
from pathlib import Path

from django.conf import settings
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker

from server.records.testing import AccountAPIMixin

SCHEMA = json.loads((Path(settings.BASE_DIR) / 'schemas' / 'coursepath-v1.schema.json').read_text(encoding='utf-8'))


def extra_courses(count):
    return [{'term_id': '2026-27-I', 'courses': [{'id': f'x{n}', 'normalized_code': f'ZZ {300 + n}', 'credits': '4'} for n in range(count)], 'placeholders': []}]


class CreditsAbove170APITests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.client.get('/api/v1/session')
        self.assertEqual(self.request(self.client, 'post', '/auth/demo', {}).status_code, 201)
        self.revision = self.client.get('/api/v1/record').json()['data']['revision']

    def check(self, semesters):
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def test_cp47_the_record_alone_has_no_surplus(self):
        analysis = self.request(self.client, 'post', '/analysis', {'record_revision': self.revision}).json()['data']
        self.assertEqual(analysis['audit']['degree']['actual'], {'total_credits': '170', 'counted_credits': '92', 'remaining_credits': '78'})
        self.assertEqual(analysis['audit']['degree_surplus']['actual'], {'surplus_credits': '0', 'earned_credits': '92'})

    def test_cp47_a_plan_with_more_courses_than_the_degree_needs_reports_the_surplus(self):
        data = self.check(extra_courses(10))
        self.assertEqual((data['degree']['counted_credits'], data['degree']['remaining_credits']), ('108', '62'))   # the courses filled open electives only: 78 - 16
        self.assertEqual(data['degree_surplus'], {'surplus_credits': '24', 'earned_credits': '132'})   # 92 + 40 credits earned or planned

    def test_cp47_a_plan_that_stays_within_the_degree_has_no_surplus(self):
        data = self.check(extra_courses(3))   # 12 credits, all inside the 16 open electives still open
        self.assertEqual((data['degree']['counted_credits'], data['degree_surplus']), ('104', {'surplus_credits': '0', 'earned_credits': '104'}))

    def test_cp47_the_requirements_view_with_a_plan_reports_it_in_the_analysis(self):
        plan = self.request(self.client, 'post', '/plans', {'label': 'Too many', 'semesters': extra_courses(10)})
        self.assertEqual(plan.status_code, 201, plan.content)
        analysis = self.request(self.client, 'post', '/analysis', {'record_revision': self.revision, 'plan_id': plan.json()['data']['id'], 'plan_revision': plan.json()['data']['revision']})
        self.assertEqual(analysis.status_code, 200, analysis.content)
        data = analysis.json()['data']
        self.assertEqual(data['audit']['degree_surplus']['projected'], {'surplus_credits': '24', 'earned_credits': '132'})
        self.assertEqual(data['plan_holds']['degree_surplus'], {'surplus_credits': '24', 'earned_credits': '132'})


if __name__ == '__main__':
    import unittest
    unittest.main()
