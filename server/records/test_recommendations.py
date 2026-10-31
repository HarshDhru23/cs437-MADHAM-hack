from django.test import TestCase
from server.records.testing import AccountAPIMixin


class RecommendedPreparationAPITests(AccountAPIMixin, TestCase):
    def test_cp05_saved_plan_warns_about_recommended_preparation_without_blocking(self):
        self.signup(self.client, 'recommendation-student')
        semesters = [{'term_id': '2026-27-I', 'courses': [{'id': 'net', 'normalized_code': 'CS 331', 'credits': '4'},
                                                          {'id': 'hss', 'normalized_code': 'HS 151', 'credits': '4'}]}]
        created = self.request(self.client, 'post', '/plans', {'semesters': semesters})
        self.assertEqual(created.status_code, 201, created.content)
        issues = {(i['code'], tuple(i['entity_refs'])): i for i in created.json()['data']['validation']['issues']}
        self.assertEqual(issues[('PREREQUISITE_MISSING', ('net',))]['severity'], 'warning')
        self.assertEqual(issues[('PREREQUISITE_UNKNOWN', ('hss',))]['severity'], 'unknown')
        rows = {r['id']: r['eligibility'] for r in created.json()['data']['validation']['per_course']}
        self.assertEqual(rows, {'net': 'ineligible', 'hss': 'unknown'})
