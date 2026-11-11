"""CR-106 (CP-21, D-36): saving or reading a plan applies the profile's advisor credit cap (ADV13 p. 7). Draft checks (`/plans/check`) keep their one
28-credit limit (D-36), so the cap reaches only the saved-plan validation. The profile has no UI or API to set the cap yet, so the tests write it directly."""
from django.test import Client, TestCase
from server.records.models import AcademicRecord
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts


def term(credits_each, count):
    return [{'term_id': '2026-27-I', 'courses': [{'id': f'c{n}', 'normalized_code': f'ZZ {300 + n}', 'credits': credits_each} for n in range(count)], 'placeholders': []}]


class SavedPlanAdvisorCapTests(AccountAPIMixin, TestCase):
    def start(self, cap):
        self.client = Client()
        self.signup(self.client, 'cap-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']
        if cap is not None:
            record = AcademicRecord.objects.get(owner__username='cap-student')
            record.profile = {**record.profile, 'advisor_cap': cap}
            record.save(update_fields=['profile'])

    def save(self, semesters):
        response = self.request(self.client, 'post', '/plans', {'semesters': semesters, 'label': 'Capped'})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def limit_issues(self, data):
        return [i for i in data['validation']['issues'] if i['code'] == 'LOAD_LIMIT']

    def test_cp21_a_25_credit_term_over_a_24_credit_advisor_cap_gets_load_limit_when_saved(self):
        self.start('24')
        issues = self.limit_issues(self.save(term('5', 5)))
        self.assertEqual([i['message'] for i in issues], ['Target workload exceeds the 24-credit limit.'])
        self.assertEqual(issues[0]['severity'], 'error')

    def test_cp21_a_term_at_the_advisor_cap_is_fine(self):
        self.start('24')
        self.assertEqual(self.limit_issues(self.save(term('6', 4))), [])

    def test_cp21_the_same_plan_without_a_cap_has_no_load_limit(self):
        self.start(None)
        self.assertEqual(self.limit_issues(self.save(term('5', 5))), [])

    def test_cp21_reading_the_saved_plan_again_still_applies_the_cap(self):
        self.start('24')
        plan = self.save(term('5', 5))
        current = self.client.get(f"/api/v1/plans/{plan['id']}").json()['data']
        updated = self.request(self.client, 'patch', f"/plans/{plan['id']}", {'expected_revision': current['revision'], 'semesters': term('5', 5)})
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(len(self.limit_issues(updated.json()['data'])), 1)

    def test_cp36_draft_checks_keep_their_single_28_credit_limit(self):
        # D-36: the cap is not applied to /plans/check (drafts); only the saved-plan validation applies it.
        self.start('24')
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': term('5', 5)})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.limit_issues(response.json()['data']), [])
