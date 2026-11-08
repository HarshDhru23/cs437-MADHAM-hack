"""D-46 (CP-37): Google sign-in accepts only IITGN accounts, and password sign-up and sign-in are off while it is configured."""
import base64
import datetime
import json
import time
from unittest.mock import patch
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID
from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings
from server.records.models import AcademicRecord
from server.records.testing import AccountAPIMixin

CLIENT_ID = 'synthetic-client.apps.googleusercontent.com'
CREDENTIAL = 'synthetic-google-credential-0123456789'


def claims(**change):
    return {'iss': 'https://accounts.google.com', 'aud': CLIENT_ID, 'sub': '1234567890', 'email': 'student.one@iitgn.ac.in', 'email_verified': True, 'hd': 'iitgn.ac.in', **change}


@override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleSignInTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.client.get('/api/v1/session').status_code, 200)

    def google(self, token=CREDENTIAL, client=None):
        return self.request(client or self.client, 'post', '/auth/google', {'credential': token})

    def sign_in_with(self, token_claims, client=None):
        with patch('server.api.views.verify_google_credential', return_value=token_claims):
            return self.google(client=client)

    def test_cp37_the_session_tells_the_page_what_sign_in_offers(self):
        data = self.client.get('/api/v1/session').json()['data']
        self.assertEqual(data['sign_in'], {'google_client_id': CLIENT_ID, 'google_domain': 'iitgn.ac.in', 'password': False})
        with override_settings(COURSEPATH_GOOGLE_CLIENT_ID=''):
            self.assertEqual(self.client.get('/api/v1/session').json()['data']['sign_in'], {'google_client_id': None, 'google_domain': 'iitgn.ac.in', 'password': True})

    def test_cp37_an_iitgn_account_signs_in_and_gets_its_own_record(self):
        response = self.sign_in_with(claims())
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['data']['username'], 'student.one@iitgn.ac.in')
        self.assertEqual(self.client.get('/api/v1/session').json()['data']['user']['username'], 'student.one@iitgn.ac.in')
        self.assertEqual(self.client.get('/api/v1/record').status_code, 200)
        user = User.objects.get(username='student.one@iitgn.ac.in')
        self.assertFalse(user.has_usable_password())  # there is no password to guess
        self.assertEqual(AcademicRecord.objects.filter(owner=user).count(), 1)

    def test_cp37_signing_in_again_reaches_the_same_account(self):
        self.assertEqual(self.sign_in_with(claims()).status_code, 201)
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': []})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.request(self.client, 'post', '/auth/logout')
        other_device = Client(enforce_csrf_checks=True)
        other_device.get('/api/v1/session')
        again = self.sign_in_with(claims(email='Student.One@IITGN.ac.in'), client=other_device)  # the same address in another case
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(other_device.get('/api/v1/record').json()['data']['revision'], 1)

    def test_cp37_an_account_outside_iitgn_is_refused_and_nothing_is_created(self):
        for label, change in [('gmail address', {'email': 'someone@gmail.com', 'hd': None}),
                              ('gmail with a forged domain claim', {'email': 'someone@gmail.com', 'hd': 'iitgn.ac.in'}),
                              ('other workspace', {'email': 'someone@iitb.ac.in', 'hd': 'iitb.ac.in'}),
                              ('lookalike domain', {'email': 'someone@iitgn.ac.in.example.com', 'hd': 'iitgn.ac.in'}),
                              ('lookalike prefix', {'email': 'someone@notiitgn.ac.in', 'hd': 'notiitgn.ac.in'}),
                              ('unverified address', {'email_verified': False}),
                              ('no domain claim', {'hd': None}),
                              ('no email', {'email': None})]:
            response = self.sign_in_with(claims(**change))
            self.assertEqual(response.status_code, 403, label)
            self.assertEqual(response.json()['issues'][0]['code'], 'NOT_IITGN_ACCOUNT', label)
        self.assertEqual(User.objects.count(), 0)
        self.assertIsNone(self.client.get('/api/v1/session').json()['data']['user'])

    def test_cp37_a_token_that_fails_google_verification_is_a_401(self):
        with patch('server.api.views.verify_google_credential', side_effect=ValueError('Token expired')):
            response = self.google()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['issues'][0]['code'], 'INVALID_CREDENTIALS')
        self.assertEqual(User.objects.count(), 0)

    def test_cp37_google_being_unreachable_is_a_503_not_a_sign_in(self):
        from google.auth.exceptions import TransportError
        with patch('server.api.views.verify_google_credential', side_effect=TransportError('no route')):
            self.assertEqual(self.google().status_code, 503)

    def test_cp37_a_missing_or_malformed_credential_is_a_400(self):
        for token in (None, '', 'short', 123, 'x' * 5000):
            self.assertEqual(self.google(token).status_code, 400, token)

    def test_cp37_password_sign_up_and_sign_in_are_off(self):
        signup = self.request(self.client, 'post', '/auth/signup', {'username': 'someone', 'password': self.password})
        self.assertEqual((signup.status_code, signup.json()['issues'][0]['code']), (403, 'PASSWORD_SIGN_IN_DISABLED'))
        self.assertEqual(User.objects.count(), 0)
        User.objects.create_user(username='older', password=self.password)
        login = self.request(self.client, 'post', '/auth/login', {'username': 'older', 'password': self.password})
        self.assertEqual((login.status_code, login.json()['issues'][0]['code']), (403, 'PASSWORD_SIGN_IN_DISABLED'))
        with override_settings(COURSEPATH_ALLOW_PASSWORD_LOGIN=True):
            self.assertEqual(self.request(self.client, 'post', '/auth/login', {'username': 'older', 'password': self.password}).status_code, 200)
            self.request(self.client, 'post', '/auth/logout')
            self.assertEqual(self.request(self.client, 'post', '/auth/signup', {'username': 'someone', 'password': self.password}).status_code, 403)  # still no new password accounts

    def test_cp37_an_older_password_account_with_the_same_name_is_never_taken_over(self):
        User.objects.create_user(username='student.one@iitgn.ac.in', password=self.password)
        response = self.sign_in_with(claims())
        self.assertEqual((response.status_code, response.json()['issues'][0]['code']), (403, 'ACCOUNT_CONFLICT'))
        self.assertIsNone(self.client.get('/api/v1/session').json()['data']['user'])

    def test_cp37_the_endpoint_does_not_exist_without_a_client_id(self):
        with override_settings(COURSEPATH_GOOGLE_CLIENT_ID=''):
            self.assertEqual(self.google().status_code, 404)

    def test_cp37_the_sign_in_attempts_are_throttled_like_password_ones(self):
        statuses = []
        with patch('server.api.views.verify_google_credential', side_effect=ValueError('bad')):
            for _ in range(12):
                statuses.append(self.google().status_code)
        self.assertEqual(statuses[:10], [401] * 10)
        self.assertEqual(statuses[10:], [429, 429])

    def test_cp37_the_pop_up_sign_in_is_not_cut_off_by_the_opener_policy(self):
        self.assertEqual(self.client.get('/api/v1/session').headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups')


def _certificate(key):
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'synthetic-google')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1)
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=1)).sign(key, hashes.SHA256()))
    return cert.public_bytes(serialization.Encoding.PEM).decode()


def _jwt(key, payload, kid='synthetic-key'):
    def b64(data):
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode()
    head = b64(json.dumps({'alg': 'RS256', 'typ': 'JWT', 'kid': kid}).encode())
    body = b64(json.dumps(payload).encode())
    signature = key.sign(f'{head}.{body}'.encode(), padding.PKCS1v15(), hashes.SHA256())
    return f'{head}.{body}.{b64(signature)}'


class _Certs:
    status = 200

    def __init__(self, key):
        self.data = json.dumps({'synthetic-key': _certificate(key)}).encode()
        self.headers = {}


class GoogleTokenVerificationTests(TestCase):
    """The real google-auth check, with Google's certificates replaced by a synthetic key: a token for another app, an expired token, a forged
    signature and a foreign issuer are all refused before the IITGN rules run."""

    def setUp(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        certs = _Certs(self.key)

        class Transport:
            def __call__(self, *args, **kwargs):
                return certs

        self.transport = patch('google.auth.transport.requests.Request', return_value=Transport())
        self.transport.start()
        self.addCleanup(self.transport.stop)

    def verify(self, token):
        from server.api.views import verify_google_credential
        with override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID):
            return verify_google_credential(token)

    def good(self, **change):
        now = int(time.time())
        return claims(iat=now, exp=now + 600, **change)

    def test_cp37_a_token_for_this_app_verifies(self):
        self.assertEqual(self.verify(_jwt(self.key, self.good()))['email'], 'student.one@iitgn.ac.in')

    def test_cp37_a_token_issued_for_another_app_is_refused(self):
        with self.assertRaises(ValueError):
            self.verify(_jwt(self.key, self.good(aud='someone-elses-app.apps.googleusercontent.com')))

    def test_cp37_an_expired_token_is_refused(self):
        with self.assertRaises(ValueError):
            self.verify(_jwt(self.key, claims(iat=int(time.time()) - 7200, exp=int(time.time()) - 3600)))

    def test_cp37_a_token_signed_by_another_key_is_refused(self):
        with self.assertRaises(ValueError):
            self.verify(_jwt(rsa.generate_private_key(public_exponent=65537, key_size=2048), self.good()))

    def test_cp37_a_token_from_another_issuer_is_refused(self):
        from google.auth.exceptions import GoogleAuthError  # the sign-in view treats this like any other refused token (a 401)
        with self.assertRaises(GoogleAuthError):
            self.verify(_jwt(self.key, self.good(iss='https://evil.example.com')))
