"""CR-107 (D-46, CP-37): a Google token that Google verified but CoursePath refuses (a personal Gmail account, an older password account) is not a
guessing signal, so students on one campus address who pick the wrong Google account do not lock each other out. Forged or invalid tokens are
still stopped after ten per address, one Google account that keeps being refused is stopped after ten, and behind the hosting proxy the address is
the client's, not the proxy's."""
from unittest.mock import patch
from django.test import Client, TestCase, override_settings
from server.records.test_google_sign_in import CLIENT_ID, CREDENTIAL, claims
from server.records.test_signin_throttle_regression import CAMPUS, ThrottleMixin


def personal(n):
    return claims(email=f'someone{n}@gmail.com', sub=f'gmail-{n}', hd=None)


@override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID)
class RejectedGoogleAccountTests(ThrottleMixin, TestCase):
    def google(self, token_claims=None, error=None, client=None, **extra):
        with patch('server.api.views.verify_google_credential', return_value=token_claims, side_effect=error):
            return self.post('/auth/google', {'credential': CREDENTIAL}, client)

    def test_cp37_ten_students_choosing_a_personal_account_do_not_lock_out_the_network(self):
        statuses = [self.google(personal(n)).status_code for n in range(10)]
        self.assertEqual(statuses, [403] * 10)
        late = self.google(claims(email='real.student@iitgn.ac.in', sub='real-1'))
        self.assertIn(late.status_code, (200, 201), late.content)

    def test_cp37_the_refusal_still_says_to_use_an_iitgn_account(self):
        refused = self.google(personal(1))
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.json()['issues'][0]['code'], 'NOT_IITGN_ACCOUNT')

    def test_cp37_one_google_account_that_keeps_being_refused_is_stopped_after_ten_but_others_are_not(self):
        statuses = [self.google(personal(0)).status_code for _ in range(11)]
        self.assertEqual(statuses, [403] * 10 + [429])
        self.assertEqual(self.google(personal(1)).status_code, 403)   # a different account is not stopped
        self.assertIn(self.google(claims(email='real.student@iitgn.ac.in', sub='real-1')).status_code, (200, 201))

    def test_cp37_forged_tokens_are_still_stopped_after_ten_from_one_address(self):
        statuses = [self.google(error=ValueError('bad signature')).status_code for _ in range(11)]
        self.assertEqual(statuses, [401] * 10 + [429])

    def test_cp37_refused_accounts_do_not_hide_forged_attempts_in_the_count(self):
        # Negative: giving counts back for verified tokens must not give back a forged token's count too.
        for n in range(5):
            self.assertEqual(self.google(personal(n)).status_code, 403)
        statuses = [self.google(error=ValueError('bad')).status_code for _ in range(11)]
        self.assertEqual(statuses, [401] * 10 + [429])

    def test_cp37_a_valid_sign_in_gives_back_only_its_own_count_not_earlier_failures(self):
        # 5 forged + a valid sign-in + 5 forged = 10 failures, so the next attempt waits. Giving the count back twice would let a success erase a failure.
        self.assertEqual([self.google(error=ValueError('bad')).status_code for _ in range(5)], [401] * 5)
        self.assertEqual(self.google(claims(email='real.student@iitgn.ac.in', sub='real-1')).status_code, 201)
        self.assertEqual([self.google(error=ValueError('bad')).status_code for _ in range(5)], [401] * 5)
        self.assertEqual(self.google(error=ValueError('bad')).status_code, 429)


@override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID, COURSEPATH_TRUST_FORWARDED_FOR=True)
class BehindTheProxyTests(TestCase):
    """The hosting front end connects from its own address and appends the client's address (with a port) to X-Forwarded-For."""
    PROXY = '169.254.129.1'

    def forged(self, client_address, spoofed='', n=1):
        out = []
        for _ in range(n):
            client = Client()
            client.get('/api/v1/session', REMOTE_ADDR=self.PROXY)
            header = (spoofed + ', ' if spoofed else '') + f'{client_address}:50123'
            with patch('server.api.views.verify_google_credential', side_effect=ValueError('bad')):
                response = client.post('/api/v1/auth/google', data='{"credential": "%s"}' % CREDENTIAL, content_type='application/json',
                                       HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value, REMOTE_ADDR=self.PROXY, HTTP_X_FORWARDED_FOR=header)
            out.append(response.status_code)
        return out

    def test_cp37_one_clients_forged_attempts_do_not_lock_another_client_behind_the_same_proxy(self):
        self.assertEqual(self.forged('203.0.113.7', n=11), [401] * 10 + [429])
        self.assertEqual(self.forged('203.0.113.8'), [401])

    def test_cp37_a_client_cannot_dodge_the_limit_by_inventing_forwarded_addresses(self):
        statuses = [self.forged('203.0.113.7', spoofed=f'198.51.100.{n}')[0] for n in range(11)]
        self.assertEqual(statuses, [401] * 10 + [429])

    @override_settings(COURSEPATH_TRUST_FORWARDED_FOR=False)
    def test_cp37_without_a_trusted_proxy_the_forwarded_header_is_ignored(self):
        # Local development and tests: the connecting address is the only address, so one client cannot pick a fresh one per request.
        statuses = [self.forged(f'203.0.113.{n}')[0] for n in range(11)]
        self.assertEqual(statuses, [401] * 10 + [429])
