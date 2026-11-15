"""Issue #153 (CP-36, CP-44): the status of a saved plan follows the saved-plan validation, so a plan over the student's GPS limit (21, D-56) or
advisor credit limit (ADV13 p. 7, D-36) is not valid in every response that carries the status: create, list, detail and update. A draft check
(`/plans/check`) keeps its one 28-credit limit (CP-44), so the same semesters stay valid there.

The plan is the generated draft for the synthetic record, which is complete and valid without a declared limit (test_plan_status). The generator
uses the 28-credit limit, so at least one of its semesters is over 20 credits; the expected counts come from the response's own LOAD_LIMIT errors."""
from decimal import Decimal
from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts


class SavedPlanStatusFollowsTheLimitsTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'limit-status-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)
        record = saved.json()['data']
        generated = self.request(self.client, 'post', '/plans/generate', {'record_revision': record['revision']}).json()['data']
        self.assertTrue(generated['summary']['complete'])
        self.semesters = generated['semesters']
        self.busiest = max(Decimal(row['target_credits']) for row in generated['validation']['workload'].values())
        self.assertGreater(self.busiest, Decimal(20), 'the generated plan needs a semester above the declared limit')
        declared = self.request(self.client, 'patch', '/record', {'expected_revision': record['revision'],
                                                                   'profile': {**record['profile'], 'standing': 'GPS', 'advisor_cap': '20'}})
        self.assertEqual(declared.status_code, 200, declared.content)
        self.record_revision = declared.json()['data']['revision']

    def errors(self, validation):
        return [i for i in validation['issues'] if i['severity'] == 'error']

    def assert_not_valid_over_the_limit(self, data, validation):
        self.assertTrue(any(i['code'] == 'LOAD_LIMIT' for i in self.errors(validation)), validation['issues'])
        self.assertFalse(data['status']['valid'])
        self.assertEqual(data['status']['problems'], len(self.errors(validation)))

    def test_cp44_a_saved_plan_over_the_declared_limit_is_not_valid_when_created(self):
        created = self.request(self.client, 'post', '/plans', {'label': 'Over the limit', 'semesters': self.semesters})
        self.assertEqual(created.status_code, 201, created.content)
        data = created.json()['data']
        self.assert_not_valid_over_the_limit(data, data['validation'])

    def test_cp44_the_list_and_the_detail_say_not_valid_too(self):
        plan = self.request(self.client, 'post', '/plans', {'label': 'Over the limit', 'semesters': self.semesters}).json()['data']
        listed = self.client.get('/api/v1/plans').json()['data']
        self.assertEqual([p['status'] for p in listed], [plan['status']])
        self.assertFalse(listed[0]['status']['valid'])
        detail = self.client.get(f"/api/v1/plans/{plan['id']}").json()['data']
        self.assertEqual(detail['status'], plan['status'])

    def test_cp44_an_updated_plan_over_the_limit_is_still_not_valid(self):
        plan = self.request(self.client, 'post', '/plans', {'label': 'Over the limit', 'semesters': self.semesters}).json()['data']
        updated = self.request(self.client, 'patch', f"/plans/{plan['id']}", {'expected_revision': plan['revision'], 'semesters': self.semesters})
        self.assertEqual(updated.status_code, 200, updated.content)
        data = updated.json()['data']
        self.assert_not_valid_over_the_limit(data, data['validation'])

    def test_cp44_clearing_the_declared_limits_makes_the_same_saved_plan_valid_again(self):
        plan = self.request(self.client, 'post', '/plans', {'label': 'Over the limit', 'semesters': self.semesters}).json()['data']
        record = self.client.get('/api/v1/record').json()['data']
        profile = {k: v for k, v in record['profile'].items() if k != 'advisor_cap'}
        cleared = self.request(self.client, 'patch', '/record', {'expected_revision': record['revision'], 'profile': {**profile, 'standing': 'normal'}})
        self.assertEqual(cleared.status_code, 200, cleared.content)
        detail = self.client.get(f"/api/v1/plans/{plan['id']}").json()['data']
        self.assertEqual(detail['status'], {'valid': True, 'problems': 0, 'uncovered_credits': '0'})

    def test_cp44_a_draft_check_of_the_same_semesters_keeps_the_28_credit_limit(self):
        checked = self.request(self.client, 'post', '/plans/check', {'record_revision': self.record_revision, 'semesters': self.semesters})
        self.assertEqual(checked.status_code, 200, checked.content)
        data = checked.json()['data']
        self.assertEqual([i for i in data['validation']['issues'] if i['code'] == 'LOAD_LIMIT'], [])
        self.assertTrue(data['status']['valid'])
