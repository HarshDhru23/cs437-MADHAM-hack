"""H14 owner deletion, preview expiry and production settings (CP-32)."""
import io
import os
import secrets
import subprocess
import sys
from datetime import timedelta
from pathlib import Path
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import Client, TestCase
from django.utils import timezone
from jsonschema import Draft202012Validator, FormatChecker
from server.records.models import AcademicPlan, ApprovalEvidence, ImportPreview, Scenario
from server.records.services import SCHEMA
from server.records.testing import AccountAPIMixin
from tests.imports.test_ims import TABLE

ROOT = Path(__file__).resolve().parents[2]


class DataDeletionTests(AccountAPIMixin, TestCase):
    def populate(self, client, username):
        self.signup(client, username)
        preview = self.request(client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        self.request(client, 'post', f"/imports/{preview['id']}/commit", {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})
        self.request(client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 1})
        plan = self.request(client, 'post', '/plans', {'semesters': []}).json()['data']
        self.request(client, 'post', '/scenarios', {'plan_id': plan['id'], 'changes': []})
        ApprovalEvidence.objects.create(owner=User.objects.get(username=username), policy_id='synthetic-policy', status='user_reported', source_refs=['synthetic-letter'])

    def assert_untouched(self, client, username):
        self.assertEqual(client.get('/api/v1/record').status_code, 200)  # the session still works
        self.assertTrue(client.get('/api/v1/record').json()['data']['attempts'])
        self.assertEqual((AcademicPlan.objects.filter(owner__username=username).count(), ApprovalEvidence.objects.filter(owner__username=username).count()), (1, 1))

    def test_cp32_deletion_needs_csrf_reauth_confirmation_and_touches_only_the_owner(self):
        owner, other = Client(enforce_csrf_checks=True), Client(enforce_csrf_checks=True)
        self.populate(owner, 'delete-owner')
        self.populate(other, 'delete-bystander')
        self.assertEqual(owner.delete('/api/v1/account/data', data='{}', content_type='application/json').status_code, 403)
        body = {'expected_revision': 1, 'password': self.password, 'confirm': 'delete my data'}
        self.assertEqual(self.request(owner, 'delete', '/account/data', {**body, 'password': self.password + '-wrong'}).status_code, 403)
        self.assertEqual(self.request(owner, 'delete', '/account/data', {**body, 'confirm': 'yes'}).status_code, 400)
        self.assertEqual(self.request(owner, 'delete', '/account/data', {**body, 'expected_revision': 0}).status_code, 409)
        deleted = self.request(owner, 'delete', '/account/data', body)
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(list(Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(deleted.json())))
        data = deleted.json()['data']
        self.assertEqual((data['account_deleted'], data['deleted']['plans'], data['deleted']['scenarios'], data['deleted']['import_previews'], data['deleted']['approval_evidence']), (False, 1, 1, 2, 1))
        self.assertGreater(data['deleted']['attempts'], 0)
        self.assertIn('backup', data['retention'].lower())
        record = owner.get('/api/v1/record').json()['data']
        self.assertEqual((record['attempts'], record['current_enrolment'], record['reported_controls'], record['revision']), ([], [], [], 2))
        self.assertEqual((owner.get('/api/v1/plans').json()['data'], owner.get('/api/v1/scenarios').json()['data']['scenarios']), ([], []))
        self.assertFalse(ImportPreview.objects.filter(owner__username='delete-owner').exists())
        self.assertFalse(ApprovalEvidence.objects.filter(owner__username='delete-owner').exists())
        bystander = other.get('/api/v1/record').json()['data']
        self.assertTrue(bystander['attempts'])
        self.assertEqual((len(other.get('/api/v1/plans').json()['data']), ImportPreview.objects.filter(owner__username='delete-bystander').count()), (1, 2))
        self.assertEqual(ApprovalEvidence.objects.filter(owner__username='delete-bystander').count(), 1)

    def test_cp32_password_rechecks_are_throttled_like_login(self):
        owner = Client()
        self.populate(owner, 'guessed-owner')  # signup counts toward the same per-address limit as login
        body = {'expected_revision': 1, 'password': self.password + '-wrong', 'confirm': 'delete my data'}
        statuses = [self.request(owner, 'delete', '/account/data', body).status_code for _ in range(12)]
        self.assertEqual(set(statuses), {403, 429}, statuses)
        self.assertEqual(statuses[statuses.index(429):], [429] * (12 - statuses.index(429)), statuses)
        self.assertLessEqual(statuses.index(429), 10, statuses)
        throttled = self.request(owner, 'delete', '/account/data', {**body, 'password': self.password})  # even the right password waits
        self.assertEqual((throttled.status_code, [i['code'] for i in throttled.json()['issues']]), (429, ['AUTH_THROTTLED']))
        self.assert_untouched(owner, 'guessed-owner')

    def test_cp32_delete_account_must_be_a_json_boolean(self):
        owner = Client()
        self.populate(owner, 'string-flag-owner')
        response = self.request(owner, 'delete', '/account/data', {'expected_revision': 1, 'password': self.password, 'confirm': 'delete my data', 'delete_account': 'true'})
        self.assertEqual(response.status_code, 400, response.content)
        self.assert_untouched(owner, 'string-flag-owner')

    def test_cp32_a_verifier_account_is_kept_with_a_json_conflict(self):
        staff, student = Client(), Client()
        self.populate(staff, 'staff-checker')
        self.populate(student, 'verified-student')
        verifier = User.objects.get(username='staff-checker')
        verifier.is_staff = True
        verifier.save(update_fields=['is_staff'])
        verified = ApprovalEvidence.objects.create(owner=User.objects.get(username='verified-student'), policy_id='synthetic-policy', status='verified',
                                                   source_refs=['synthetic-letter'], verifier=verifier, verified_at=timezone.now())
        staff.raise_request_exception = False
        response = self.request(staff, 'delete', '/account/data', {'expected_revision': 1, 'password': self.password, 'confirm': 'delete my data', 'delete_account': True})
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual([i['code'] for i in response.json()['issues']], ['ACCOUNT_HAS_VERIFICATIONS'])
        self.assert_untouched(staff, 'staff-checker')
        self.assertTrue(ApprovalEvidence.objects.filter(pk=verified.pk, verifier=verifier).exists())

    def test_cp32_deleting_the_account_ends_every_session(self):
        first, second = Client(), Client()
        self.populate(first, 'leaving-student')
        self.assertEqual(self.request(second, 'post', '/auth/login', {'username': 'leaving-student', 'password': self.password}).status_code, 200)
        gone = self.request(first, 'delete', '/account/data', {'expected_revision': 1, 'password': self.password, 'confirm': 'delete my data', 'delete_account': True})
        self.assertEqual((gone.status_code, gone.json()['data']['account_deleted']), (200, True))
        self.assertEqual((first.get('/api/v1/record').status_code, second.get('/api/v1/record').status_code), (401, 401))
        self.assertEqual(self.request(Client(), 'post', '/auth/login', {'username': 'leaving-student', 'password': self.password}).status_code, 401)
        self.assertFalse(AcademicPlan.objects.filter(owner__username='leaving-student').exists() or Scenario.objects.filter(owner__username='leaving-student').exists())


class PreviewExpiryTests(AccountAPIMixin, TestCase):
    def test_cp32_expired_previews_are_purged_with_their_grades(self):
        self.signup(self.client, 'expiry-student')
        old = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        fresh = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        ImportPreview.objects.filter(pk=old['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        call_command('purge_previews', stdout=io.StringIO())
        self.assertFalse(ImportPreview.objects.filter(pk=old['id']).exists())
        self.assertTrue(ImportPreview.objects.filter(pk=fresh['id']).exists())  # an unexpired preview survives the purge
        kept = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        stale = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        ImportPreview.objects.filter(pk=stale['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0})  # each new preview purges the owner's expired ones
        self.assertTrue(ImportPreview.objects.filter(pk=kept['id']).exists())
        self.assertFalse(ImportPreview.objects.filter(pk=stale['id']).exists())
        ImportPreview.objects.filter(pk=kept['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        backup = self.client.get('/api/v1/export').json()
        restore = self.request(self.client, 'post', '/imports/backup-preview', {'expected_revision': 0, 'backup': backup})  # a backup preview purges them too
        self.assertEqual(restore.status_code, 201, restore.content)
        self.assertFalse(ImportPreview.objects.filter(pk=kept['id']).exists())
        self.assertTrue(ImportPreview.objects.filter(pk=restore.json()['data']['id']).exists())


class ProductionSettingsTests(TestCase):
    def test_cp32_production_settings_pass_the_deploy_check_and_hide_tracebacks(self):
        env = {**os.environ, 'COURSEPATH_ENV': 'production', 'COURSEPATH_SECRET_KEY': secrets.token_urlsafe(50), 'COURSEPATH_GOOGLE_CLIENT_ID': 'synthetic-client.apps.googleusercontent.com',
               'COURSEPATH_ALLOWED_HOSTS': 'coursepath.example.invalid', 'COURSEPATH_DB_NAME': 'unused', 'COURSEPATH_DB_USER': 'unused',
               'COURSEPATH_DB_PASSWORD': 'unused', 'COURSEPATH_DB_HOST': '127.0.0.1'}
        check = subprocess.run([sys.executable, 'server/manage.py', 'check', '--deploy', '--fail-level', 'WARNING'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
        probe = ('from django.conf import settings; import django; django.setup(); '
                 'print(settings.DEBUG, settings.SESSION_COOKIE_SECURE, settings.CSRF_COOKIE_SECURE, settings.SECURE_SSL_REDIRECT, settings.DATABASES["default"]["ENGINE"])')
        shown = subprocess.run([sys.executable, '-c', probe], cwd=ROOT, env={**env, 'DJANGO_SETTINGS_MODULE': 'server.config.settings'}, capture_output=True, text=True, timeout=120)
        self.assertEqual(shown.stdout.split(), ['False', 'True', 'True', 'True', 'django.db.backends.postgresql'], shown.stderr)
        missing = {k: v for k, v in env.items() if k != 'COURSEPATH_SECRET_KEY'}
        refused = subprocess.run([sys.executable, 'server/manage.py', 'check'], cwd=ROOT, env=missing, capture_output=True, text=True, timeout=120)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('COURSEPATH_SECRET_KEY', refused.stderr)
