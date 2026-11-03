from django.test import Client, TestCase, override_settings
from jsonschema import Draft202012Validator, FormatChecker
from server.records.services import SCHEMA
from server.records.testing import AccountAPIMixin

SEMESTERS = [{'term_id': '2026-27-I', 'courses': [{'id': 'os', 'normalized_code': 'CS 330', 'credits': '4'}, {'id': 'net', 'normalized_code': 'CS 331', 'credits': '4'}]},
             {'term_id': '2027-28-I', 'courses': [{'id': 'later', 'normalized_code': 'CS 432', 'credits': '4'}]}]
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


class ScenarioAPITests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.signup(self.client, 'scenario-owner')
        self.plan = self.request(self.client, 'post', '/plans', {'semesters': SEMESTERS}).json()['data']

    def create(self, **payload):
        response = self.request(self.client, 'post', '/scenarios', {'plan_id': self.plan['id'], **payload})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(list(VALIDATOR.iter_errors(response.json())))
        return response.json()['data']

    def apply(self, scenario_id, scenario_revision, plan_revision, client=None):
        response = self.request(client or self.client, 'post', f'/scenarios/{scenario_id}/apply-plan',
                                {'expected_scenario_revision': scenario_revision, 'expected_plan_revision': plan_revision})
        self.assertFalse(list(VALIDATOR.iter_errors(response.json())))
        return response

    def saved_plan(self):
        return self.client.get('/api/v1/plans/' + self.plan['id']).json()['data']

    @property
    def original(self):
        return {k: v for k, v in self.plan.items() if k != 'validation'}

    def test_cp28_apply_pins_the_compared_scenario_revision_and_the_plan_revision(self):
        scenario = self.create(changes=[{'op': 'drop', 'item_id': 'net'}])
        path = f"/scenarios/{scenario['id']}/apply-plan"
        for payload in [{'expected_plan_revision': 0}, {'expected_scenario_revision': 0}, {'expected_scenario_revision': '0', 'expected_plan_revision': 0}]:
            refused = self.request(self.client, 'post', path, payload)
            self.assertEqual((refused.status_code, [i['code'] for i in refused.json()['issues']]), (400, ['INVALID_INPUT']), payload)
        # Another tab edits the scenario after this one compared revision 0.
        edited = self.request(self.client, 'patch', '/scenarios/' + scenario['id'], {'expected_revision': 0, 'changes': [{'op': 'drop', 'item_id': 'os'}]})
        self.assertEqual(edited.status_code, 200, edited.content)
        conflict = self.apply(scenario['id'], 0, 0)
        self.assertEqual((conflict.status_code, [i['code'] for i in conflict.json()['issues']]), (409, ['REVISION_CONFLICT']))
        self.assertEqual(conflict.json()['data'], {'current_revision': 1, 'action': 'reload_compare'})
        stale_plan = self.apply(scenario['id'], 1, 7)
        self.assertEqual((stale_plan.status_code, stale_plan.json()['data']), (409, {'current_revision': 0, 'action': 'reload_compare'}))
        self.assertEqual(self.saved_plan(), self.original)
        applied = self.apply(scenario['id'], 1, 0)
        self.assertEqual(applied.status_code, 200, applied.content)
        self.assertEqual([c['id'] for c in applied.json()['data']['plan']['semesters'][0]['courses']], ['net'])

    def test_cp28_record_change_after_compare_asks_for_a_rebase_not_a_reload(self):
        scenario = self.create(changes=[{'op': 'drop', 'item_id': 'net'}])
        moved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': []})
        self.assertEqual((moved.status_code, moved.json()['data']['revision']), (200, 1))
        stale = self.apply(scenario['id'], 0, 0)
        self.assertEqual((stale.status_code, [i['code'] for i in stale.json()['issues']]), (409, ['SCENARIO_STALE']))
        self.assertEqual(stale.json()['data'], {'action': 'rebase', 'scenario_revision': 0, 'current_record_revision': 1, 'current_plan_revision': 0,
                                                'current_rule_version': scenario['rule_version'], 'baseline_record_revision': 0,
                                                'baseline_plan_revision': 0, 'rule_version': scenario['rule_version']})
        self.assertEqual(self.saved_plan()['revision'], 0)
        self.assertEqual(self.request(self.client, 'patch', '/scenarios/' + scenario['id'], {'expected_revision': 0, 'rebase': True}).status_code, 200)
        self.assertEqual(self.apply(scenario['id'], 1, 0).status_code, 200)

    def test_cp28_foreign_scenario_mutations_are_not_found_and_change_nothing(self):
        scenario = self.create(changes=[{'op': 'drop', 'item_id': 'net'}])
        foreign = Client()
        self.signup(foreign, 'scenario-intruder')  # same record and plan revisions (0) as the owner's baseline
        self.assertEqual(self.apply(scenario['id'], 0, 0, foreign).status_code, 404)
        self.assertEqual(self.request(foreign, 'patch', '/scenarios/' + scenario['id'], {'expected_revision': 0, 'label': 'taken'}).status_code, 404)
        self.assertEqual(self.request(foreign, 'delete', '/scenarios/' + scenario['id'], {'expected_revision': 0}).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/scenarios/' + scenario['id']).json()['data'], scenario)
        self.assertEqual(self.saved_plan(), self.original)

    def test_cp28_scenarios_are_owned_isolated_and_compared_without_touching_the_record(self):
        scenario = self.create(label='Fail OS', changes=[{'op': 'fail', 'item_id': 'os'}, {'op': 'drop', 'item_id': 'net'}])
        self.assertEqual((scenario['baseline_record_revision'], scenario['baseline_plan_revision']), (0, self.plan['revision']))
        foreign = Client()
        self.signup(foreign, 'scenario-stranger')
        self.assertEqual(foreign.get('/api/v1/scenarios/' + scenario['id']).status_code, 404)
        self.assertEqual(self.request(foreign, 'post', '/scenarios/compare', {'scenario_ids': [scenario['id']]}).status_code, 404)
        self.assertEqual(self.request(foreign, 'post', '/scenarios', {'plan_id': self.plan['id'], 'changes': []}).status_code, 404)
        compared = self.request(self.client, 'post', '/scenarios/compare', {'scenario_ids': [scenario['id']]})
        self.assertEqual(compared.status_code, 200, compared.content)
        self.assertFalse(list(VALIDATOR.iter_errors(compared.json())))
        result = compared.json()['data']['comparisons'][0]
        self.assertTrue(result['scenario']['performance']['hypothetical'])
        self.assertEqual(result['deltas']['workload']['2026-27-I'], {'baseline': '8', 'scenario': '0'})
        record = self.client.get('/api/v1/record').json()['data']
        self.assertEqual((record['revision'], record['attempts']), (0, []))
        self.assertEqual(self.client.get('/api/v1/scenarios').json()['data']['scenarios'][0]['id'], scenario['id'])
        self.assertEqual(self.request(self.client, 'post', '/scenarios', {'plan_id': self.plan['id'], 'changes': [{'op': 'teleport'}]}).status_code, 400)

    def test_cp28_stale_scenario_must_rebase_before_plan_apply(self):
        scenario = self.create(changes=[{'op': 'drop', 'item_id': 'net'}, {'op': 'fail', 'item_id': 'os'}])
        moved = self.request(self.client, 'patch', '/plans/' + self.plan['id'], {'expected_revision': self.plan['revision'], 'semesters': SEMESTERS})
        self.assertEqual(moved.status_code, 200)
        stale = self.request(self.client, 'post', '/scenarios/compare', {'scenario_ids': [scenario['id']]}).json()
        self.assertTrue(stale['data']['comparisons'][0]['stale'])
        self.assertIn('SCENARIO_STALE', [i['code'] for i in stale['issues']])
        refused = self.apply(scenario['id'], 0, 1)
        self.assertEqual((refused.status_code, [i['code'] for i in refused.json()['issues']]), (409, ['SCENARIO_STALE']))
        rebased = self.request(self.client, 'patch', '/scenarios/' + scenario['id'], {'expected_revision': 0, 'rebase': True})
        self.assertEqual((rebased.status_code, rebased.json()['data']['baseline_plan_revision']), (200, 1))
        self.assertEqual(self.request(self.client, 'patch', '/scenarios/' + scenario['id'], {'expected_revision': 0, 'label': 'x'}).status_code, 409)
        applied = self.apply(scenario['id'], 1, 1)
        self.assertEqual(applied.status_code, 200, applied.content)
        self.assertFalse(list(VALIDATOR.iter_errors(applied.json())))
        data = applied.json()['data']
        self.assertEqual([c['id'] for c in data['plan']['semesters'][0]['courses']], ['os'])
        self.assertEqual([s['op'] for s in data['not_applied']], ['fail'])
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['revision'], 0)
        self.assertEqual(self.request(self.client, 'delete', '/scenarios/' + scenario['id'], {'expected_revision': 1}).status_code, 200)
        self.assertEqual(self.client.get('/api/v1/scenarios/' + scenario['id']).status_code, 404)

    @override_settings(COURSEPATH_CALENDAR_DIR=None)  # the committed calendar is exercised in test_official_data
    def test_cp33_cp34_internship_cases_compare_on_one_baseline_without_a_calendar(self):
        cases = [self.create(internship={'duration_choice': 'none'}),
                 self.create(internship={'duration_choice': 'three_months', 'start_date': '2027-05-01', 'end_date_exclusive': '2027-08-01', 'placement_mode': 'onsite_full_time'}),
                 self.create(internship={'duration_choice': 'six_months', 'start_date': '2027-07-01', 'end_date_exclusive': '2028-01-01', 'placement_mode': 'onsite_full_time',
                                         'modules': [{'id': 'm1', 'credits': '4', 'intended_allocation': 'open_elective', 'status': 'completed', 'grade': 'P'}]})]
        compared = self.request(self.client, 'post', '/scenarios/compare', {'scenario_ids': [c['id'] for c in cases]})
        self.assertEqual(compared.status_code, 200, compared.content)
        table = compared.json()['data']['internship_cases']
        self.assertEqual([c['duration_choice'] for c in table], ['none', 'three_months', 'six_months'])
        self.assertEqual([c['approved_credits'] for c in table], ['0', '0', '0'])
        self.assertEqual(table[2]['credits']['proposed'], '4')  # completed by the student's own account, never earned without verified approval
        self.assertIn('CALENDAR_MISSING', [i['code'] for i in compared.json()['issues']])
        claimed = {'duration_choice': 'three_months', 'start_date': '2027-05-01', 'end_date_exclusive': '2027-08-01',
                   'modules': [{'id': 'm1', 'credits': '4', 'intended_allocation': 'hss', 'status': 'proposed', 'approval_status': 'verified'}]}
        self.assertEqual(self.request(self.client, 'post', '/scenarios', {'plan_id': self.plan['id'], 'internship': claimed}).status_code, 400)
