"""H13 versioned JSON export and reviewed restore (CP-30)."""
import json
from unittest import mock
from django.db import DatabaseError
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.services import SCHEMA
from server.records.testing import AccountAPIMixin
from tests.imports.test_ims import TABLE

VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


class ExportRestoreTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.signup(self.client, 'backup-owner')
        preview = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        accepted = self.request(self.client, 'post', f"/imports/{preview['id']}/commit",
                                {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.attempts = accepted.json()['data']['attempts']
        self.plan = self.request(self.client, 'post', '/plans', {'label': 'Main', 'semesters': [
            {'term_id': '2026-27-I', 'courses': [{'id': 'c1', 'normalized_code': 'CS 330', 'credits': '4'}]}]}).json()['data']
        self.request(self.client, 'post', '/scenarios', {'plan_id': self.plan['id'], 'changes': [{'op': 'drop', 'item_id': 'c1'}]})

    def export(self, client=None):
        response = (client or self.client).get('/api/v1/export', {'kind': 'json'})
        self.assertEqual(response.status_code, 200, response.content)
        return response

    def test_cp30_export_is_versioned_owned_and_free_of_credentials(self):
        response = self.export()
        self.assertIn('attachment', response['Content-Disposition'])
        body = response.json()
        self.assertFalse(list(VALIDATOR.iter_errors(body)))
        data = body['data']
        self.assertEqual((data['kind'], data['backup_version'], data['account']['username']), ('coursepath-backup', '1', 'backup-owner'))
        self.assertEqual((data['record']['revision'], len(data['record']['attempts'])), (1, len(self.attempts)))
        self.assertEqual((len(data['plans']), len(data['scenarios'])), (1, 1))
        self.assertEqual((data['rule_version'], data['rule_review_status']), ('cse-2024-v1', 'reviewed'))
        self.assertIn('adv13', [s['id'] for s in data['sources']])  # the backup names the rules it was made with
        text = response.content.decode().lower()
        for secret in ['password', 'pbkdf2', 'sessionid', 'csrf', self.password.lower()]:
            self.assertNotIn(secret, text)
        self.assertEqual(Client().get('/api/v1/export').status_code, 401)
        self.assertEqual(self.client.get('/api/v1/export', {'kind': 'pdf'}).status_code, 400)
        other = Client()
        self.signup(other, 'backup-stranger')
        self.assertEqual(self.export(other).json()['data']['record']['attempts'], [])

    def test_cp30_restore_previews_diff_then_commits_only_on_confirmation(self):
        backup = self.export().json()
        cleared = self.request(self.client, 'patch', '/record', {'expected_revision': 1, 'attempts': []})
        self.assertEqual(cleared.status_code, 200)
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 2, 'backup': backup})
        self.assertEqual(preview.status_code, 201, preview.content)
        self.assertFalse(list(VALIDATOR.iter_errors(preview.json())))
        diff = preview.json()['data']['diff']
        self.assertEqual((len(diff['attempts_added']), diff['attempts_removed'], diff['plans_to_create'], diff['scenarios_not_restored']), (len(self.attempts), [], 1, 1))
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['attempts'], [])  # preview mutates nothing
        preview_id = preview.json()['data']['id']
        self.assertEqual(self.request(self.client, 'post', f'/imports/{preview_id}/commit', {'expected_revision': 2}).status_code, 400)
        committed = self.request(self.client, 'post', f'/imports/{preview_id}/commit', {'expected_revision': 2, 'confirm': True})
        self.assertEqual(committed.status_code, 200, committed.content)
        self.assertEqual(committed.json()['data']['attempts'], self.attempts)
        self.assertEqual(committed.json()['data']['revision'], 3)
        self.assertEqual(len(self.client.get('/api/v1/plans').json()['data']), 2)
        self.assertEqual(self.request(self.client, 'post', f'/imports/{preview_id}/commit', {'expected_revision': 3, 'confirm': True}).status_code, 409)

    def test_cp30_unknown_foreign_or_malformed_backups_are_rejected_without_changes(self):
        backup = self.export().json()['data']
        for broken, status in [({**backup, 'backup_version': '99'}, 422), ({**backup, 'kind': 'something-else'}, 422),
                               ({**backup, 'account': {'username': 'someone-else'}}, 422),
                               ({**backup, 'record': {**backup['record'], 'attempts': [{'id': 'x', 'credits': 1.5}]}}, 400),
                               ({**backup, 'plans': [{'semesters': [{'term_id': 'not-a-term', 'courses': []}]}]}, 400)]:
            response = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 1, 'backup': broken})
            self.assertEqual(response.status_code, status, (broken.get('backup_version'), response.content))
        self.assertEqual(self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 0, 'backup': backup}).status_code, 409)
        stranger = Client()
        self.signup(stranger, 'restore-stranger')
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 1, 'backup': backup}).json()['data']
        self.assertEqual(self.request(stranger, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'confirm': True}).status_code, 404)
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['revision'], 1)

    def test_cp30_failed_restore_rolls_back_the_record(self):
        backup = self.export().json()
        self.request(self.client, 'patch', '/record', {'expected_revision': 1, 'attempts': []})
        preview = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 2, 'backup': backup}).json()['data']
        with mock.patch('server.records.models.AcademicPlan.objects.bulk_create', side_effect=DatabaseError('disk full')):
            with self.assertRaises(DatabaseError):
                self.request(self.client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 2, 'confirm': True})
        record = self.client.get('/api/v1/record').json()['data']
        self.assertEqual((record['revision'], record['attempts']), (2, []))
        self.assertEqual(len(self.client.get('/api/v1/plans').json()['data']), 1)
        self.assertEqual(json.loads(json.dumps(backup))['data']['record']['revision'], 1)
