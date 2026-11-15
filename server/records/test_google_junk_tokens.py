"""Issue #107 (CP-37, D-46): junk sign-in tokens must not lock a shared campus address out. A credential that is not even shaped like a Google ID
token (three base64url parts and an RS256 header naming a key), or that names a key Google does not use, is refused without counting against the
address and without asking Google for anything. Google's signing certificates are cached for as long as Google says (Cache-Control max-age); an
unknown key makes at most one fresh fetch per five minutes. A well-formed token with a bad signature is still counted (ten per address, then 429).

The tokens here are signed with a key made for the test and its self-signed certificate; nothing reaches Google."""
import base64
import datetime
import json
import time
from unittest.mock import patch
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from django.test import TestCase, override_settings
from google.auth import crypt, jwt
from server.api import views
from server.records.test_google_sign_in import CLIENT_ID, claims
from server.records.test_signin_throttle_regression import ThrottleMixin

KID = 'synthetic-google-key-1'


def keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'synthetic-google-certs')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1)
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=1)).sign(key, hashes.SHA256()))
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return private, cert.public_bytes(serialization.Encoding.PEM).decode()


PRIVATE, CERT = keypair()
OTHER_PRIVATE, _ = keypair()


def token(private=PRIVATE, kid=KID, **change):
    now = int(time.time())
    payload = {**claims(), 'iat': now, 'exp': now + 600, **change}
    return jwt.encode(crypt.RSASigner.from_string(private, key_id=kid), payload).decode()


def b64(data):
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')


JUNK = ['synthetic-google-credential-0123456789', 'a.b', 'x' * 40 + '.' + 'y' * 40 + '.' + 'z' * 40,
        b64({'alg': 'none'}) + '.' + b64({'sub': '1'}) + '.sig-sig-sig-sig',
        b64({'alg': 'RS256'}) + '.' + b64({'sub': '1'}) + '.sig-sig-sig-sig',          # no key ID
        'eyJhbGciOiJSUzI1NiJ9.e30.!!!!!!!!!!!!!!!!!!!!!!']


@override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID)
class JunkTokenTests(ThrottleMixin, TestCase):
    def setUp(self):
        views._GOOGLE_CERTS.update(certs={}, expires=0.0, fetched=None)
        self.fetches = 0

        def fetch():
            self.fetches += 1
            return {KID: CERT}, 3600
        patcher = patch('server.api.views._fetch_google_certs', side_effect=fetch)
        patcher.start()
        self.addCleanup(patcher.stop)

    def sign_in(self, credential):
        return self.post('/auth/google', {'credential': credential})

    def test_cp37_a_real_signed_token_signs_in_and_the_certificates_are_fetched_once(self):
        first = self.sign_in(token())
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(self.sign_in(token()).status_code, 200)
        self.assertEqual(self.fetches, 1)

    def test_cp37_thirty_junk_tokens_do_not_lock_the_address_or_reach_google(self):
        statuses = [self.sign_in(JUNK[n % len(JUNK)]).status_code for n in range(30)]
        self.assertEqual(set(statuses), {400, 401})   # 400 for one too short to be a token at all, 401 for the rest
        self.assertEqual(self.fetches, 0)
        self.assertEqual(self.sign_in(token()).status_code, 201)

    def test_cp37_tokens_naming_a_key_google_does_not_use_are_not_counted_and_fetch_at_most_once(self):
        statuses = [self.sign_in(token(kid=f'made-up-{n}')).status_code for n in range(30)]
        self.assertEqual(statuses, [401] * 30)
        self.assertEqual(self.fetches, 1)   # the first asks Google once; the rest wait five minutes before asking again
        self.assertEqual(self.sign_in(token()).status_code, 201)

    def test_cp37_an_unknown_key_is_looked_up_again_after_five_minutes(self):
        self.sign_in(token(kid='rotated-key'))
        views._GOOGLE_CERTS['fetched'] -= views.CERT_REFETCH_SECONDS + 1
        self.sign_in(token(kid='rotated-key'))
        self.assertEqual(self.fetches, 2)

    def test_cp37_expired_certificates_are_fetched_again(self):
        self.assertEqual(self.sign_in(token()).status_code, 201)
        views._GOOGLE_CERTS['expires'] = 0.0
        self.assertEqual(self.sign_in(token()).status_code, 200)
        self.assertEqual(self.fetches, 2)

    def test_cp37_well_formed_tokens_with_a_bad_signature_are_still_stopped_after_ten(self):
        statuses = [self.sign_in(token(private=OTHER_PRIVATE)).status_code for _ in range(11)]
        self.assertEqual(statuses, [401] * 10 + [429])

    def test_cp37_a_token_for_another_app_or_issuer_is_refused(self):
        self.assertEqual(self.sign_in(token(aud='someone-else.apps.googleusercontent.com')).status_code, 401)
        self.assertEqual(self.sign_in(token(iss='https://evil.example.com')).status_code, 401)
