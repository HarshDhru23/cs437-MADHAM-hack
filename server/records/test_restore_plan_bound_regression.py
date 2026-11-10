"""CR-103 review [P2] (CP-30, CP-36): restoring a backup cannot take an account past the saved-plan limit that POST /plans enforces."""
from django.test import Client, TestCase
from server.api.views import MAX_SAVED_PLANS
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts


def plan(label):
    return {'label': label, 'semesters': []}


class RestoreKeepsThePlanLimitTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'restore-bound')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']

    def save_plans(self, count, prefix='Saved'):
        for n in range(count):
            self.assertEqual(self.request(self.client, 'post', '/plans', plan(f'{prefix} {n}')).status_code, 201)

    def owned(self):
        return [p['label'] for p in self.client.get('/api/v1/plans').json()['data']]

    def backup_with(self, labels, keep_existing=False):
        data = self.client.get('/api/v1/export', {'kind': 'json'}).json()['data']
        data['plans'] = (data['plans'] if keep_existing else []) + [{'id': f'restored-{label}', **plan(label)} for label in labels]
        return data

    def preview(self, backup):
        response = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': self.revision, 'backup': backup})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def commit(self, preview):
        return self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': self.revision, 'confirm': True})

    def test_cp36_restoring_50_new_plans_into_a_full_account_is_refused_and_changes_nothing(self):
        self.save_plans(MAX_SAVED_PLANS)
        preview = self.preview(self.backup_with([f'Other {n}' for n in range(MAX_SAVED_PLANS)]))
        self.assertEqual(preview['diff']['plans_to_create'], MAX_SAVED_PLANS)
        refused = self.commit(preview)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(len(self.owned()), MAX_SAVED_PLANS)
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['revision'], self.revision)   # the whole restore rolled back
        self.assertEqual(self.request(self.client, 'post', '/plans', plan('One too many')).status_code, 400)

    def test_cp36_a_preview_made_before_the_account_filled_up_is_checked_at_commit(self):
        preview = self.preview(self.backup_with([f'Other {n}' for n in range(MAX_SAVED_PLANS)]))   # 0 plans owned: fits when previewed
        self.save_plans(1)
        refused = self.commit(preview)
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(self.owned(), ['Saved 0'])

    def test_cp36_a_restore_that_just_fits_is_still_accepted(self):
        # Negative: the bound must not refuse a restore that ends at exactly the limit.
        self.save_plans(MAX_SAVED_PLANS - 3)
        committed = self.commit(self.preview(self.backup_with(['Other 0', 'Other 1', 'Other 2'])))
        self.assertEqual(committed.status_code, 200, committed.content)
        self.assertEqual(len(self.owned()), MAX_SAVED_PLANS)

    def test_cp36_restoring_plans_that_already_exist_at_the_limit_is_still_a_skip_not_a_refusal(self):
        # Negative: a duplicate restore adds nothing, so a full account may repeat it.
        self.save_plans(MAX_SAVED_PLANS)
        backup = self.backup_with([], keep_existing=True)
        preview = self.preview(backup)
        self.assertEqual((preview['diff']['plans_to_create'], len(preview['diff']['plans_skipped_existing'])), (0, MAX_SAVED_PLANS))
        committed = self.commit(preview)
        self.assertEqual(committed.status_code, 200, committed.content)
        self.assertEqual(len(self.owned()), MAX_SAVED_PLANS)
