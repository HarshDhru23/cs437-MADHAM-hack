"""CP-32 with D-46: a Google-only account has no password, so it re-authenticates a deletion with a fresh Google ID token for its own IITGN address.
A password account still needs its password. Google is never reached: only `server.api.views.verify_google_credential` is replaced."""
from unittest.mock import patch
from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings
from server.records.models import AcademicPlan
from server.records.testing import AccountAPIMixin
from server.records.test_google_sign_in import CLIENT_ID, CREDENTIAL, claims
from tests.imports.test_ims import TABLE

OWNER = 'student.one@iitgn.ac.in'


@override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleAccountDeletionTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/v1/session')
        with patch('server.api.views.verify_google_credential', return_value=claims()):
            self.assertEqual(self.request(self.client, 'post', '/auth/google', {'credential': CREDENTIAL}).status_code, 201)
        self.assertFalse(User.objects.get(username=OWNER).has_usable_password())
        preview = self.request(self.client, 'post', '/imports/preview', {'kind': 'ims', 'text': TABLE, 'expected_revision': 0}).json()['data']
        committed = self.request(self.client, 'post', f"/imports/{preview['id']}/commit",
                                 {'expected_revision': 0, 'accepted_candidate_ids': [a['id'] for a in preview['candidate_attempts']], 'resolutions': {}})
        self.assertEqual(committed.status_code, 200, committed.content)
        self.request(self.client, 'post', '/plans', {'semesters': []})

    def delete(self, token_claims=None, error=None, **body):
        body = {'expected_revision': 1, 'confirm': 'delete my data', **body}
        with patch('server.api.views.verify_google_credential', return_value=token_claims, side_effect=error) as verify:
            return self.request(self.client, 'delete', '/account/data', body), verify

    def assert_untouched(self):
        record = self.client.get('/api/v1/record')
        self.assertEqual(record.status_code, 200)
        self.assertTrue(record.json()['data']['attempts'])
        self.assertEqual(AcademicPlan.objects.filter(owner__username=OWNER).count(), 1)

    def test_cp32_a_google_account_deletes_its_data_with_a_fresh_google_credential(self):
        response, verify = self.delete(claims(), google_credential=CREDENTIAL)
        self.assertEqual(response.status_code, 200, response.content)
        verify.assert_called_once_with(CREDENTIAL)
        data = response.json()['data']
        self.assertEqual((data['account_deleted'], data['deleted']['plans'], data['record_revision']), (False, 1, 2))  # revision 1 (import) + 1 (cleared)
        self.assertEqual(self.client.get('/api/v1/record').json()['data']['attempts'], [])

    def test_cp32_a_google_account_deletes_itself_with_the_same_address_in_another_case(self):
        response, _ = self.delete(claims(email='Student.One@IITGN.ac.in'), google_credential=CREDENTIAL, delete_account=True)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIs(response.json()['data']['account_deleted'], True)
        self.assertFalse(User.objects.filter(username=OWNER).exists())
        self.assertEqual(self.client.get('/api/v1/record').status_code, 401)

    def test_cp32_a_google_account_without_a_valid_credential_for_its_own_address_deletes_nothing(self):
        for label, kwargs in [('no credential', {}),
                              ('a password instead', {'password': ''}),
                              ('malformed credential', {'google_credential': 'short'}),
                              ('credential not a string', {'google_credential': 12345678901234567890123}),
                              ('token refused by Google', {'error': ValueError('Token expired'), 'google_credential': CREDENTIAL}),
                              ('another IITGN student', {'token_claims': claims(email='student.two@iitgn.ac.in'), 'google_credential': CREDENTIAL}),
                              ('unverified address', {'token_claims': claims(email_verified=False), 'google_credential': CREDENTIAL}),
                              ('no domain claim', {'token_claims': claims(hd=None), 'google_credential': CREDENTIAL}),
                              ('lookalike address', {'token_claims': claims(email='student.one@iitgn.ac.in.example.com'), 'google_credential': CREDENTIAL})]:
            response, _ = self.delete(**kwargs)
            self.assertEqual((response.status_code, [i['code'] for i in response.json()['issues']]), (403, ['REAUTH_FAILED']), label)
            self.assert_untouched()

    def test_cp32_google_reauthentication_is_refused_when_no_client_id_is_configured(self):
        # Without our client ID Google's library would skip the audience check, so a token minted for any other app must not count.
        with override_settings(COURSEPATH_GOOGLE_CLIENT_ID=''):
            response, verify = self.delete(claims(), google_credential=CREDENTIAL)
        self.assertEqual((response.status_code, [i['code'] for i in response.json()['issues']]), (403, ['REAUTH_FAILED']))
        verify.assert_not_called()
        self.assert_untouched()

    def test_cp32_google_being_unreachable_is_a_503_and_deletes_nothing(self):
        from google.auth.exceptions import TransportError
        response, _ = self.delete(error=TransportError('no route'), google_credential=CREDENTIAL)
        self.assertEqual((response.status_code, [i['code'] for i in response.json()['issues']]), (503, ['SIGN_IN_UNAVAILABLE']))
        self.assert_untouched()

    def test_cp32_google_rechecks_are_throttled_like_password_ones(self):
        statuses = [self.delete(error=ValueError('bad'), google_credential=CREDENTIAL)[0].status_code for _ in range(12)]
        self.assertEqual(set(statuses), {403, 429}, statuses)
        self.assertEqual(statuses[statuses.index(429):], [429] * (12 - statuses.index(429)), statuses)
        throttled, _ = self.delete(claims(), google_credential=CREDENTIAL)  # even a good credential waits
        self.assertEqual((throttled.status_code, [i['code'] for i in throttled.json()['issues']]), (429, ['AUTH_THROTTLED']))
        self.assert_untouched()


class PasswordAccountDeletionTests(AccountAPIMixin, TestCase):
    def test_cp32_a_password_account_cannot_swap_its_password_for_a_google_credential(self):
        owner = Client()
        self.signup(owner, OWNER)  # an older password account that happens to use an IITGN address (D-46 never links the two)
        body = {'expected_revision': 0, 'confirm': 'delete my data', 'google_credential': CREDENTIAL}
        with override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID), patch('server.api.views.verify_google_credential', return_value=claims()):
            refused = self.request(owner, 'delete', '/account/data', body)
            self.assertEqual((refused.status_code, [i['code'] for i in refused.json()['issues']]), (403, ['REAUTH_FAILED']))
            accepted = self.request(owner, 'delete', '/account/data', {**body, 'password': self.password})
        self.assertEqual(accepted.status_code, 200, accepted.content)
