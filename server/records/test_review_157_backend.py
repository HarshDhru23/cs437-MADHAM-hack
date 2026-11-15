"""Issue #157, the server items.

1. A backup round trip restores the standing and advisor credit limit the student declared (CP-44, CP-30): restoring replaces the record, and the
   two declared values are part of it. Values a student could not declare are refused, as in PATCH /record.
2. A course code in current enrolment is stored in its normalized form ('cs202' is 'CS 202'), from PATCH /record and from a backup (CP-21).
"""
from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts


class Base(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'review-owner')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)

    def current(self):
        return self.client.get('/api/v1/record').json()['data']

    def declare(self, **changes):
        record = self.current()
        profile = {k: v for k, v in record['profile'].items() if k not in changes or changes[k] is not None}
        profile.update({k: v for k, v in changes.items() if v is not None})
        response = self.request(self.client, 'patch', '/record', {'expected_revision': record['revision'], 'profile': profile})
        self.assertEqual(response.status_code, 200, response.content)

    def backup(self):
        response = self.client.get('/api/v1/export', {'kind': 'json'})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['data']

    def restore(self, backup):
        revision = self.current()['revision']
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': revision, 'backup': backup})
        if preview.status_code != 201:
            return preview, None
        committed = self.request(self.client, 'post', f"/imports/{preview.json()['data']['id']}/commit", {'expected_revision': revision, 'confirm': True})
        return preview, committed


class RestoreStudyLoadTests(Base):
    def test_cp44_a_backup_round_trip_restores_standing_and_the_advisor_limit(self):
        self.declare(standing='GPS', advisor_cap='20')
        backup = self.backup()
        self.declare(standing='normal', advisor_cap='24')
        preview, committed = self.restore(backup)
        self.assertTrue(preview.json()['data']['diff']['study_load_changed'])
        self.assertEqual(committed.status_code, 200, committed.content)
        profile = self.current()['profile']
        self.assertEqual((profile['standing'], profile['advisor_cap']), ('GPS', '20'))

    def test_cp44_a_backup_without_a_limit_clears_the_limit_set_since(self):
        backup = self.backup()   # nothing declared yet
        self.declare(standing='GPS', advisor_cap='24')
        _, committed = self.restore(backup)
        self.assertEqual(committed.status_code, 200, committed.content)
        profile = self.current()['profile']
        self.assertNotIn('advisor_cap', profile)
        self.assertNotEqual(profile.get('standing'), 'GPS')

    def test_cp44_the_same_study_load_is_reported_unchanged(self):
        self.declare(standing='GPS')
        preview, _ = self.restore(self.backup())
        self.assertFalse(preview.json()['data']['diff']['study_load_changed'])

    def test_cp44_a_backup_with_a_limit_no_student_could_declare_is_refused(self):
        backup = self.backup()
        backup['record']['profile'] = {**backup['record']['profile'], 'advisor_cap': '40'}
        preview, _ = self.restore(backup)
        self.assertEqual(preview.status_code, 400, preview.content)
        self.assertNotIn('advisor_cap', self.current()['profile'])

    def test_cp44_a_restore_never_changes_the_curriculum_fields(self):
        backup = self.backup()
        backup['record']['profile'] = {**backup['record']['profile'], 'curriculum_version': 'cse-2099-v9', 'standing': 'GPS'}
        _, committed = self.restore(backup)   # as before #157, the backup's curriculum fields are ignored; only the declared study load comes back
        self.assertEqual(committed.status_code, 200, committed.content)
        self.assertEqual(self.current()['profile']['curriculum_version'], 'cse-2024-v1')
        self.assertEqual(self.current()['profile']['standing'], 'GPS')


class EnrolmentCodeTests(Base):
    def enrol(self, code):
        record = self.current()
        rows = [{'id': 'e1', 'normalized_code': code, 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True}]
        return self.request(self.client, 'patch', '/record', {'expected_revision': record['revision'], 'current_enrolment': rows})

    def test_cp21_a_lower_case_enrolment_code_is_stored_as_cs_202(self):
        response = self.enrol('cs202')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([r['normalized_code'] for r in self.current()['current_enrolment']], ['CS 202'])

    def test_cp21_an_enrolment_code_from_a_backup_is_normalized_too(self):
        self.assertEqual(self.enrol('CS 202').status_code, 200)
        backup = self.backup()
        backup['record']['current_enrolment'][0]['normalized_code'] = 'cs 202'
        _, committed = self.restore(backup)
        self.assertEqual(committed.status_code, 200, committed.content)
        self.assertEqual([r['normalized_code'] for r in self.current()['current_enrolment']], ['CS 202'])

    def test_cp21_a_code_that_is_not_a_course_code_is_still_refused(self):
        self.assertEqual(self.enrol('not a code!').status_code, 400)
