"""Issue #155 (CP-28, CR-137): an account holds at most MAX_SAVED_SCENARIOS saved scenarios, the way it holds at most MAX_SAVED_PLANS plans (CR-103).
The next create is refused and writes nothing. A sample-student session gets the same limit, so a visitor without a Google sign-in cannot fill the
shared database. Deleting a scenario makes room again."""
from django.test import Client, TestCase
from server.api.views import MAX_SAVED_SCENARIOS
from server.records.models import Scenario
from server.records.testing import AccountAPIMixin

SEMESTERS = [{'term_id': '2026-27-I', 'courses': [{'id': 'os', 'normalized_code': 'CS 330', 'credits': '4'}]}]


class ScenarioLimitBase(AccountAPIMixin, TestCase):
    def save_plan(self, client):
        response = self.request(client, 'post', '/plans', {'label': 'Base', 'semesters': SEMESTERS})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def create(self, client, plan, n):
        return self.request(client, 'post', '/scenarios', {'plan_id': plan['id'], 'label': f'Try {n}', 'changes': [{'op': 'drop', 'item_id': 'os'}]})

    def fill(self, client, plan):
        for n in range(MAX_SAVED_SCENARIOS):
            response = self.create(client, plan, n)
            self.assertEqual(response.status_code, 201, response.content)

    def owned(self, client):
        return client.get('/api/v1/scenarios').json()['data']['scenarios']


class ScenarioLimitTests(ScenarioLimitBase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'scenario-limit')
        self.plan = self.save_plan(self.client)

    def test_cp28_the_limit_is_a_small_fixed_number(self):
        self.assertGreaterEqual(MAX_SAVED_SCENARIOS, 10)
        self.assertLessEqual(MAX_SAVED_SCENARIOS, 50)

    def test_cp28_one_scenario_past_the_limit_is_refused_and_nothing_is_written(self):
        self.fill(self.client, self.plan)
        before = Scenario.objects.count()
        refused = self.create(self.client, self.plan, 'over')
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()['issues'][0]['code'], 'SCENARIO_LIMIT')
        self.assertIn(str(MAX_SAVED_SCENARIOS), refused.json()['issues'][0]['message'])
        self.assertEqual(Scenario.objects.count(), before)
        self.assertEqual(len(self.owned(self.client)), MAX_SAVED_SCENARIOS)

    def test_cp28_deleting_a_scenario_makes_room_again(self):
        self.fill(self.client, self.plan)
        first = self.owned(self.client)[0]
        deleted = self.request(self.client, 'delete', f"/scenarios/{first['id']}", {'expected_revision': first['revision']})
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertEqual(self.create(self.client, self.plan, 'again').status_code, 201)

    def test_cp28_the_limit_is_per_account(self):
        self.fill(self.client, self.plan)
        other = Client()
        self.signup(other, 'second-student')
        self.assertEqual(self.create(other, self.save_plan(other), 'mine').status_code, 201)


class SampleStudentScenarioLimitTests(ScenarioLimitBase):
    def test_cp28_a_sample_student_cannot_go_past_the_limit_either(self):
        client = Client()
        self.assertEqual(client.get('/api/v1/session').status_code, 200)
        started = self.request(client, 'post', '/auth/demo')
        self.assertEqual(started.status_code, 201, started.content)
        plan = self.save_plan(client)
        room = MAX_SAVED_SCENARIOS - len(self.owned(client))
        for n in range(room):
            self.assertEqual(self.create(client, plan, n).status_code, 201)
        before = Scenario.objects.count()
        self.assertEqual(self.create(client, plan, 'over').status_code, 400)
        self.assertEqual(Scenario.objects.count(), before)
