"""Applying a scenario with no plan edit keeps the plan revision (issue #20; CP-28).

Apply writes drop/postpone/replace edits only (server/README.md, apply-plan). A scenario with only fail or cap changes writes nothing,
so the plan revision must not move, or every other scenario on the plan turns stale for no change.
"""
from django.test import TestCase
from server.records.testing import AccountAPIMixin

SEMESTERS = [{'term_id': '2026-27-I', 'courses': [{'id': 'os', 'normalized_code': 'CS 330', 'credits': '4'}, {'id': 'net', 'normalized_code': 'CS 331', 'credits': '4'}]},
             {'term_id': '2027-28-I', 'courses': [{'id': 'later', 'normalized_code': 'CS 432', 'credits': '4'}]}]


class ApplyNoPlanEditTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.signup(self.client, 'apply-noop')
        self.plan = self.request(self.client, 'post', '/plans', {'semesters': SEMESTERS}).json()['data']

    def create(self, changes):
        response = self.request(self.client, 'post', '/scenarios', {'plan_id': self.plan['id'], 'changes': changes})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def apply(self, scenario, plan_revision):
        return self.request(self.client, 'post', f"/scenarios/{scenario['id']}/apply-plan",
                            {'expected_scenario_revision': scenario['revision'], 'expected_plan_revision': plan_revision})

    def saved(self):
        return self.client.get('/api/v1/plans/' + self.plan['id']).json()['data']

    def test_cp28_apply_without_plan_edits_keeps_the_plan_revision(self):
        hypothetical = self.create([{'op': 'fail', 'item_id': 'os'}, {'op': 'cap', 'term_id': '2026-27-I', 'credits': '4'}])
        drop = self.create([{'op': 'drop', 'item_id': 'net'}])
        applied = self.apply(hypothetical, 0)
        self.assertEqual(applied.status_code, 200, applied.content)
        data = applied.json()['data']
        self.assertEqual([s['op'] for s in data['not_applied']], ['fail', 'cap'])  # still reported as left out
        self.assertEqual(data['plan']['revision'], 0)
        self.assertEqual((self.saved()['revision'], self.saved()['semesters']), (0, self.plan['semesters']))
        # The other scenario is still current: it compares unstale and applies against plan revision 0.
        compared = self.request(self.client, 'post', '/scenarios/compare', {'scenario_ids': [drop['id']]}).json()['data']
        self.assertFalse(compared['comparisons'][0]['stale'])
        # Negative: a real plan edit still bumps the revision (0 -> 1).
        edited = self.apply(drop, 0)
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertEqual(edited.json()['data']['plan']['revision'], 1)
        self.assertEqual([c['id'] for c in self.saved()['semesters'][0]['courses']], ['os'])
