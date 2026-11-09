"""Issue #11 (CP-05, D-17): saved-plan and draft checks count confirmed current enrolment as recommended preparation taken earlier.

Team recommendation (data/prerequisites): CS 331 <- ES 242. ES 242 confirmed in 2026-27-I and CS 331 planned in 2026-27-II is
"planned earlier, helps only if passed" -> PREREQUISITE_CONDITIONAL, not "missing: ES 242".
"""
from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin

ENROLMENT = [{'id': 'ce1', 'normalized_code': 'ES 242', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True}]


def history(attempt_id, code, term):
    return {'id': attempt_id, 'normalized_code': code, 'original_code': code, 'title': 'Synthetic', 'credits': '4', 'grade': 'A',
            'term_id': term, 'completion_status': 'completed', 'learning_designation': 'degree', 'source_refs': [], 'user_corrections': []}


class CurrentEnrolmentPlanCheckTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'enrolment-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': [history('h1', 'ES 112', '2025-26-I')], 'current_enrolment': ENROLMENT})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']

    def codes(self, validation):
        return {(i['code'], tuple(i['entity_refs'])) for i in validation['issues'] if i['code'].startswith('PREREQUISITE')}

    def test_cp05_plan_check_counts_confirmed_current_enrolment(self):
        semesters = [{'term_id': '2026-27-II', 'courses': [{'id': 'os', 'normalized_code': 'CS 331', 'credits': '4'}], 'placeholders': []}]
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.codes(response.json()['data']['validation']), {('PREREQUISITE_CONDITIONAL', ('os',))})

    def test_cp05_saved_plan_counts_confirmed_current_enrolment(self):
        semesters = [{'term_id': '2026-27-II', 'courses': [{'id': 'os', 'normalized_code': 'CS 331', 'credits': '4'}], 'placeholders': []}]
        created = self.request(self.client, 'post', '/plans', {'label': 'After ES 242', 'semesters': semesters})
        self.assertEqual(created.status_code, 201, created.content)
        validation = created.json()['data']['validation']
        self.assertEqual(self.codes(validation), {('PREREQUISITE_CONDITIONAL', ('os',))})
        self.assertEqual([r['eligibility'] for r in validation['per_course'] if r['id'] == 'os'], ['conditional'])

    def test_cp05_current_enrolment_in_the_same_term_still_warns(self):
        # Not a co-requisite: ES 242 in the same term as CS 331 is not earlier preparation.
        semesters = [{'term_id': '2026-27-I', 'courses': [{'id': 'os', 'normalized_code': 'CS 331', 'credits': '4'}], 'placeholders': []}]
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})
        self.assertEqual(self.codes(response.json()['data']['validation']), {('PREREQUISITE_MISSING', ('os',))})
