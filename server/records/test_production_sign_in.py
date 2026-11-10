"""CR-140 (D-46, CP-37): in production every sign-in is a server-verified IITGN Google account. A missing Google setting stops the server from starting,
and no setting turns password sign-up or sign-in on."""
import os
import secrets
import subprocess
import sys
from pathlib import Path

from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings

from server.records.testing import AccountAPIMixin

ROOT = Path(__file__).resolve().parents[2]
CLIENT_ID = 'synthetic-client.apps.googleusercontent.com'


def production_env(**extra):
    env = {**os.environ, 'COURSEPATH_ENV': 'production', 'COURSEPATH_SECRET_KEY': secrets.token_urlsafe(50),
           'COURSEPATH_ALLOWED_HOSTS': 'coursepath.example.invalid', 'COURSEPATH_DB_NAME': 'unused', 'COURSEPATH_DB_USER': 'unused',
           'COURSEPATH_DB_PASSWORD': 'unused', 'COURSEPATH_DB_HOST': '127.0.0.1', 'DJANGO_SETTINGS_MODULE': 'server.config.settings'}
    env.pop('COURSEPATH_GOOGLE_CLIENT_ID', None)
    env.pop('COURSEPATH_ALLOW_PASSWORD_LOGIN', None)
    return {**env, **extra}


def manage_check(env):
    return subprocess.run([sys.executable, 'server/manage.py', 'check'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)


class ProductionStartupTests(TestCase):
    def test_cp37_production_does_not_start_without_a_google_client_id(self):
        refused = manage_check(production_env())
        self.assertNotEqual(refused.returncode, 0, refused.stdout)
        self.assertIn('COURSEPATH_GOOGLE_CLIENT_ID', refused.stderr)

    def test_cp37_a_blank_client_id_is_no_client_id(self):
        # Negative: an empty or whitespace-only value (a mistyped or half-deleted app setting) must not count as configured.
        for blank in ('', '   '):
            refused = manage_check(production_env(COURSEPATH_GOOGLE_CLIENT_ID=blank))
            self.assertNotEqual(refused.returncode, 0, repr(blank))
            self.assertIn('COURSEPATH_GOOGLE_CLIENT_ID', refused.stderr)

    def test_cp37_production_starts_with_a_client_id(self):
        started = manage_check(production_env(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID))
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)

    def test_cp37_development_still_starts_without_a_client_id(self):
        env = {k: v for k, v in production_env().items() if k not in {'COURSEPATH_ENV'}}
        env['COURSEPATH_ENV'] = 'development'
        started = manage_check(env)
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)

    def test_cp37_the_legacy_password_switch_is_ignored_in_production(self):
        probe = 'import django; django.setup(); from django.conf import settings; print(settings.COURSEPATH_ALLOW_PASSWORD_LOGIN, settings.COURSEPATH_PRODUCTION)'
        shown = subprocess.run([sys.executable, '-c', probe], cwd=ROOT, capture_output=True, text=True, timeout=120,
                               env=production_env(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID, COURSEPATH_ALLOW_PASSWORD_LOGIN='1'))
        self.assertEqual(shown.stdout.split(), ['False', 'True'], shown.stderr)


@override_settings(COURSEPATH_PRODUCTION=True)
class ProductionPasswordSignInTests(AccountAPIMixin, TestCase):
    """Even if the startup check were bypassed, the views refuse password sign-up and sign-in in production, whatever else is set."""

    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.client.get('/api/v1/session').status_code, 200)
        User.objects.create_user(username='older', password=self.password)

    def refused(self, path, body):
        response = self.request(self.client, 'post', path, body)
        issues = response.json()['issues']
        self.assertEqual((response.status_code, issues[0]['code'] if issues else None), (403, 'PASSWORD_SIGN_IN_DISABLED'), response.content)
        self.assertIsNone(self.client.get('/api/v1/session').json()['data']['user'])

    @override_settings(COURSEPATH_GOOGLE_CLIENT_ID='', COURSEPATH_ALLOW_PASSWORD_LOGIN=False)
    def test_cp37_no_client_id_does_not_open_password_sign_up_or_sign_in(self):
        before = User.objects.count()
        self.refused('/auth/signup', {'username': 'anyone@gmail.com', 'password': self.password})
        self.refused('/auth/login', {'username': 'older', 'password': self.password})
        self.assertEqual(User.objects.count(), before)
        self.assertFalse(self.client.get('/api/v1/session').json()['data']['sign_in']['password'])

    @override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID, COURSEPATH_ALLOW_PASSWORD_LOGIN=True)
    def test_cp37_the_legacy_switch_does_not_let_a_password_in(self):
        self.refused('/auth/login', {'username': 'older', 'password': self.password})
        self.refused('/auth/signup', {'username': 'anyone@gmail.com', 'password': self.password})

    @override_settings(COURSEPATH_GOOGLE_CLIENT_ID='', COURSEPATH_ALLOW_PASSWORD_LOGIN=True)
    def test_cp37_the_legacy_switch_with_no_client_id_does_not_let_a_password_in_either(self):
        self.refused('/auth/login', {'username': 'older', 'password': self.password})
