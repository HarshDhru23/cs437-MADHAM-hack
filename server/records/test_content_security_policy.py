"""CR-110 item 5 (CP-32): the app shell carries a Content-Security-Policy that allows only its own scripts, Google's sign-in script and frame, and the
one inline theme script in index.html (by hash); API answers are JSON and carry none. The real-browser check (Google button, no violations) is in
the PR description."""
import base64
import hashlib
import tempfile
from pathlib import Path
from django.test import TestCase, override_settings

THEME = "\n      try { document.documentElement.setAttribute('data-theme', 'dark'); } catch (e) {}\n    "
PAGE = '<!doctype html><html><head><script>{inline}</script></head><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>'


def sha256(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode('utf-8')).digest()).decode() + "'"


def shell(inline=THEME):
    directory = tempfile.TemporaryDirectory()
    (Path(directory.name) / 'index.html').write_text(PAGE.format(inline=inline), encoding='utf-8')
    return directory


def directives(header):
    return {part.strip().split(' ', 1)[0]: part.strip().split(' ', 1)[1:] and part.strip().split(' ', 1)[1].split() for part in header.split(';') if part.strip()}


class ContentSecurityPolicyTests(TestCase):
    def get(self, path='/login', inline=THEME, **settings_):
        with shell(inline) as directory, override_settings(COURSEPATH_FRONTEND_DIR=Path(directory), **settings_):
            return self.client.get(path)

    def test_the_app_shell_carries_a_policy(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertIn('Content-Security-Policy', response)
        self.assertNotIn('Content-Security-Policy-Report-Only', response)

    def test_scripts_are_limited_to_the_app_google_sign_in_and_the_theme_script_by_hash(self):
        policy = directives(self.get()['Content-Security-Policy'])
        self.assertEqual(policy['script-src'], ["'self'", 'https://accounts.google.com/gsi/client', sha256(THEME)])
        self.assertNotIn("'unsafe-inline'", policy['script-src'])
        self.assertNotIn("'unsafe-eval'", policy['script-src'])
        self.assertNotIn("'unsafe-inline'", policy['default-src'])

    def test_google_sign_in_can_frame_connect_and_style_itself_and_nothing_else_external(self):
        policy = directives(self.get()['Content-Security-Policy'])
        self.assertEqual(policy['frame-src'], ['https://accounts.google.com/gsi/'])
        self.assertEqual(policy['connect-src'], ["'self'", 'https://accounts.google.com/gsi/'])
        self.assertEqual(policy['style-src'], ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'])   # Google's script injects the button's CSS inline
        self.assertEqual(policy['default-src'], ["'self'"])
        self.assertEqual(policy['object-src'], ["'none'"])
        self.assertEqual(policy['base-uri'], ["'self'"])
        self.assertEqual(policy['frame-ancestors'], ["'none'"])
        self.assertEqual(policy['form-action'], ["'self'"])

    def test_the_hash_follows_the_inline_script_so_an_edit_to_it_is_not_silently_blocked_or_allowed(self):
        edited = THEME.replace("'dark'", "'light'")
        policy = directives(self.get(inline=edited)['Content-Security-Policy'])
        self.assertIn(sha256(edited), policy['script-src'])
        self.assertNotIn(sha256(THEME), policy['script-src'])

    def test_a_shell_without_an_inline_script_allows_none(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(COURSEPATH_FRONTEND_DIR=Path(directory)):
            (Path(directory) / 'index.html').write_text('<html><body><script type="module" src="/assets/a.js"></script></body></html>', encoding='utf-8')
            policy = directives(self.client.get('/')['Content-Security-Policy'])
        self.assertEqual(policy['script-src'], ["'self'", 'https://accounts.google.com/gsi/client'])

    def test_an_external_script_tag_is_not_mistaken_for_an_inline_one(self):
        policy = directives(self.get()['Content-Security-Policy'])
        self.assertEqual(len([t for t in policy['script-src'] if t.startswith("'sha256-")]), 1)   # the module script has a src, so it adds no hash

    def test_every_deep_link_gets_the_same_policy(self):
        first, second = self.get('/plan/7f0c1f7e-aaaa-bbbb-cccc-123456789abc'), self.get('/record')
        self.assertEqual(first['Content-Security-Policy'], second['Content-Security-Policy'])

    def test_a_report_only_switch_keeps_the_policy_but_does_not_enforce_it(self):
        response = self.get(COURSEPATH_CSP_REPORT_ONLY=True)
        self.assertIn('Content-Security-Policy-Report-Only', response)
        self.assertNotIn('Content-Security-Policy', response)

    def test_api_answers_are_json_and_carry_no_policy(self):
        # Negative: the header belongs to HTML pages only.
        response = self.client.get('/api/v1/health')
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertNotIn('Content-Security-Policy', response)
