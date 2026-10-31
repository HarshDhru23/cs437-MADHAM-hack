"""H14 owner deletion, preview expiry and production settings (CP-32)."""
import io
import os
import secrets
import subprocess
import sys
from datetime import timedelta
from pathlib import Path
from django.core.management import call_command
from django.test import Client, TestCase
from django.utils import timezone
from jsonschema import Draft202012Validator, FormatChecker
from server.records.models import AcademicPlan, ImportPreview, Scenario
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

    def test_cp32_deletion_needs_csrf_reauth_confirmation_and_touches_only_the_owner(self):
        owner, other = Client(enforce_csrf_checks=True), Client(enforce_csrf_checks=True)
        self.populate(owner, 'delete-owner')
        self.populate(other, 'delete-bystander')
        self.assertEqual(owner.delete('/api/v1/account/data', data='{}', content_type='application/json').status_code, 403)
        body = {'expected_revision': 1, 'password': self.password, 'confirm': 'delete my data'}
        self.assertEqual(self.request(owner, 'delete', '/account/data', {**body, 'password': 'wrong-password'}).status_code, 403)
        self.assertEqual(self.request(owner, 'delete', '/account/data', {**body, 'confirm': 'yes'}).status_code, 400)
        self.assertEqual(self.request(owner, 'delete', '/account/data', {**body, 'expected_revision': 0}).status_code, 409)
        deleted = self.request(owner, 'delete', '/account/data', body)
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(list(Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(deleted.json())))
        data = deleted.json()['data']
        self.assertEqual((data['account_deleted'], data['deleted']['plans'], data['deleted']['scenarios'], data['deleted']['import_previews']), (False, 1, 1, 2))
        self.assertGreater(data['deleted']['attempts'], 0)
        self.assertIn('backup', data['retention'].lower())
        record = owner.get('/api/v1/record').json()['data']
        self.assertEqual((record['attempts'], record['current_enrolment'], record['reported_controls'], record['revision']), ([], [], [], 2))
        self.assertEqual((owner.get('/api/v1/plans').json()['data'], owner.get('/api/v1/scenarios').json()['data']['scenarios']), ([], []))
        self.assertFalse(ImportPreview.objects.filter(owner__username='delete-owner').exists())
        bystander = other.get('/api/v1/record').json()['data']
        self.assertTrue(bystander['attempts'])
        self.assertEqual((len(other.get('/api/v1/plans').json()['data']), ImportPreview.objects.filter(owner__username='delete-bystander').count()), (1, 2))

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
        ImportPreview.objects.filter(pk=old['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        call_command('purge_previews', stdout=io.StringIO())
        self.assertFalse(ImportPreview.objects.filter(pk=old['id']).exists())
        kept = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        stale = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        ImportPreview.objects.filter(pk=stale['id']).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0})  # each new preview purges the owner's expired ones
        self.assertTrue(ImportPreview.objects.filter(pk=kept['id']).exists())
        self.assertFalse(ImportPreview.objects.filter(pk=stale['id']).exists())


class ProductionSettingsTests(TestCase):
    def test_cp32_production_settings_pass_the_deploy_check_and_hide_tracebacks(self):
        env = {**os.environ, 'COURSEPATH_ENV': 'production', 'COURSEPATH_SECRET_KEY': secrets.token_urlsafe(50),
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
