"""H14 hosting: one origin serves the API and the built React app behind a platform TLS proxy (CP-32 production settings)."""
import os
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path
from django.test import TestCase, override_settings

ROOT = Path(__file__).resolve().parents[2]
MARKER = 'coursepath-spa-shell-marker'


def production_env(**extra):
    return {**os.environ, 'COURSEPATH_ENV': 'production', 'COURSEPATH_SECRET_KEY': secrets.token_urlsafe(50),
            'COURSEPATH_ALLOWED_HOSTS': 'coursepath.example.invalid', 'COURSEPATH_DB_NAME': 'unused', 'COURSEPATH_DB_USER': 'unused',
            'COURSEPATH_DB_PASSWORD': 'unused', 'COURSEPATH_DB_HOST': '127.0.0.1', 'DJANGO_SETTINGS_MODULE': 'server.config.settings', **extra}


def run_probe(code, env):
    done = subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout.split()


class HealthAndSpaTests(TestCase):
    def test_health_endpoint_needs_no_sign_in_and_reports_the_database(self):
        response = self.client.get('/api/v1/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data'], {'status': 'ok', 'database': 'ok'})
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(self.client.post('/api/v1/health').status_code, 405)

    def test_deep_links_get_the_app_shell_but_unknown_api_paths_stay_404(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'index.html').write_text(f'<html><body>{MARKER}</body></html>', encoding='utf-8')
            with override_settings(COURSEPATH_FRONTEND_DIR=Path(directory)):
                deep = self.client.get('/plan/7f0c1f7e-aaaa-bbbb-cccc-123456789abc')
                self.assertEqual(deep.status_code, 200)
                self.assertIn(MARKER, deep.content.decode())
                self.assertTrue(deep['Content-Type'].startswith('text/html'))
                missing_api = self.client.get('/api/v1/no-such-route')
                self.assertEqual(missing_api.status_code, 404)
                self.assertNotIn(MARKER, missing_api.content.decode())
                self.assertEqual(self.client.get('/assets/missing.js').status_code, 404)  # a missing asset is not the app shell
                self.assertEqual(self.client.post('/plan/anything').status_code, 405)

    def test_a_missing_frontend_build_is_a_clear_404_not_a_crash(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(COURSEPATH_FRONTEND_DIR=Path(directory) / 'absent'):
            self.assertEqual(self.client.get('/plan/x').status_code, 404)


class ProxyProductionSettingsTests(TestCase):
    def test_platform_proxy_headers_hosts_and_origins_are_configured(self):
        env = production_env(COURSEPATH_CSRF_TRUSTED_ORIGINS='https://coursepath.example.invalid, https://second.example.invalid',
                             WEBSITE_HOSTNAME='coursepath-app.azurewebsites.invalid')
        probe = ('from django.conf import settings as s; import django; django.setup(); '
                 'print(s.SECURE_PROXY_SSL_HEADER[0], s.SECURE_PROXY_SSL_HEADER[1], ",".join(s.CSRF_TRUSTED_ORIGINS), ",".join(s.ALLOWED_HOSTS), '
                 '"whitenoise.middleware.WhiteNoiseMiddleware" in s.MIDDLEWARE)')
        header, scheme, origins, hosts, whitenoise = run_probe(probe, env)
        self.assertEqual((header, scheme), ('HTTP_X_FORWARDED_PROTO', 'https'))
        self.assertEqual(origins, 'https://coursepath.example.invalid,https://second.example.invalid')
        self.assertEqual(hosts, 'coursepath.example.invalid,coursepath-app.azurewebsites.invalid')  # the platform's own host name is trusted, nothing else
        self.assertEqual(whitenoise, 'True')

    def test_https_via_the_proxy_is_served_and_plain_http_is_redirected_without_a_loop(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'index.html').write_text(f'<html>{MARKER}</html>', encoding='utf-8')
            env = production_env(COURSEPATH_FRONTEND_DIR=directory)
            probe = ('import django; django.setup(); from django.test import Client; c = Client(); h = "coursepath.example.invalid"; '
                     'p = c.get("/plan/1", HTTP_HOST=h); s = c.get("/plan/1", HTTP_HOST=h, HTTP_X_FORWARDED_PROTO="https"); '
                     'w = c.get("/", HTTP_HOST=h, HTTP_X_FORWARDED_PROTO="https"); '
                     'k = c.get("/api/v1/health", HTTP_HOST=h); '
                     'print(p.status_code, s.status_code, w.status_code, k.status_code, "ok" if b"%s" in s.content and b"%s" in w.content else "shell-missing")' % (MARKER, MARKER))
            plain, secure, root, health_http, shell = run_probe(probe, env)
            self.assertEqual((plain, secure, root, shell), ('301', '200', '200', 'ok'))
            self.assertNotEqual(health_http, '301')  # the platform's health probe is plain HTTP and must not be redirected
