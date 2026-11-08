"""Issues #17 and #18 (CP-21, D-36): a draft check has one 28-credit limit; saved-plan validation keeps the profile's GPS and advisor limits (ADV13 p. 7).

The profile's standing and advisor cap have no API yet, so the tests set them on the stored record.
"""
from django.test import Client, TestCase
from server.records.models import AcademicRecord
from server.records.testing import AccountAPIMixin

# Six 4-credit courses = 24 credits: above the GPS limit (21) and an advisor cap of 20, within the draft limit (28).
SEMESTERS = [{'term_id': '2026-27-I', 'courses': [{'id': f'c{i}', 'normalized_code': f'ZZ 4{i:02d}', 'credits': '4'} for i in range(6)], 'placeholders': []}]


class LoadCapAPITests(AccountAPIMixin, TestCase):
    def student(self, username, **profile):
        client = Client()
        self.signup(client, username)
        record = AcademicRecord.objects.get(owner__username=username)
        record.profile = {**record.profile, **profile}
        record.save()
        return client, record.revision

    def load_errors(self, validation):
        return [i['message'] for i in validation['issues'] if i['code'] == 'LOAD_LIMIT']

    def test_cp21_saved_plan_validation_applies_the_profile_advisor_cap(self):
        client, _ = self.student('advisor-student', standing='regular', advisor_cap='20')
        created = self.request(client, 'post', '/plans', {'label': 'Heavy', 'semesters': SEMESTERS})
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(self.load_errors(created.json()['data']['validation']), ['Target workload exceeds the 20-credit limit.'])

    def test_cp21_draft_check_ignores_the_advisor_cap_and_gps_standing(self):
        for username, profile in (('advisor-draft', {'standing': 'regular', 'advisor_cap': '20'}), ('gps-draft', {'standing': 'GPS'})):
            client, revision = self.student(username, **profile)
            response = self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': SEMESTERS})
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(self.load_errors(response.json()['data']['validation']), [], username)

    def test_cp21_saved_plan_validation_keeps_the_gps_limit(self):
        client, _ = self.student('gps-student', standing='GPS')
        created = self.request(client, 'post', '/plans', {'label': 'Heavy', 'semesters': SEMESTERS})
        self.assertEqual(self.load_errors(created.json()['data']['validation']), ['Target workload exceeds the 21-credit limit.'])
