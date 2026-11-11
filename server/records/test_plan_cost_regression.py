"""CR-103 (CP-36): one account's plans cannot tie up the server. A placeholder asks for a sensible number of credits, an online placeholder is
bounded by the 16-credit pool, and the number of saved plans is limited."""
import time
from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts


def online(id, credits):
    return {'id': id, 'requirement_id': 'open-electives', 'desired_credits': credits, 'label': 'Online course', 'online': True}


def terms(count, credits):
    years = [f'{2026 + n}-{27 + n}' for n in range(count // 2 + 1)]
    ids = [f'{y}-{s}' for y in years for s in ('I', 'II')][:count]
    return [{'term_id': t, 'courses': [], 'placeholders': [online(f'o{i}', credits)]} for i, t in enumerate(ids)]


class PlanCostTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'cost-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']

    def check(self, semesters):
        return self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})

    def test_cp36_an_absurd_placeholder_size_is_refused_with_a_400(self):
        response = self.check(terms(1, '10000'))
        self.assertEqual(response.status_code, 400, response.content)

    def test_cp36_a_sensible_placeholder_size_is_still_accepted(self):
        # Negative: the bound must not refuse what a real plan holds (a term is at most 28 credits).
        response = self.check(terms(1, '28'))
        self.assertEqual(response.status_code, 200, response.content)

    def test_cp36_many_large_online_placeholders_finish_quickly_and_warn(self):
        started = time.perf_counter()
        response = self.check(terms(40, '100'))
        elapsed = time.perf_counter() - started
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['data']
        self.assertEqual(data['online']['counted_credits'], '16')
        self.assertIn('ONLINE_CREDIT_LIMIT', [i['code'] for i in data['validation']['issues']])
        self.assertLess(elapsed, 3, f'took {elapsed:.2f}s')

    def test_cp36_an_account_cannot_keep_more_than_50_saved_plans(self):
        for n in range(50):
            created = self.request(self.client, 'post', '/plans', {'semesters': [], 'label': f'Plan {n}'})
            self.assertEqual(created.status_code, 201, created.content)
        refused = self.request(self.client, 'post', '/plans', {'semesters': [], 'label': 'One too many'})
        self.assertEqual(refused.status_code, 400, refused.content)
        listed = self.client.get('/api/v1/plans')
        self.assertEqual(len(listed.json()['data']), 50)
