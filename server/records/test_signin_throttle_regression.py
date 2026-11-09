"""The sign-in limit (10 failed attempts per address per 15 minutes, then 429) counts failures only. Students on one campus network share an
address, so their successful sign-ins must not lock each other out; guesses must still be stopped, and a success must not wipe earlier failures."""
import json
from unittest.mock import patch
from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings
from server.records.models import AcademicRecord
from server.records.testing import AccountAPIMixin
from server.records.test_google_sign_in import CLIENT_ID, CREDENTIAL, claims

CAMPUS = '10.9.9.9'  # every request below comes from this one address


class ThrottleMixin(AccountAPIMixin):
    def post(self, path, payload, client=None):
        client = client or Client()
        client.get('/api/v1/session', REMOTE_ADDR=CAMPUS)
        token = client.cookies.get('csrftoken')
        return client.post('/api/v1' + path, data=json.dumps(payload), content_type='application/json',
                           HTTP_X_CSRFTOKEN=token.value if token else '', REMOTE_ADDR=CAMPUS)


@override_settings(COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleSignInThrottleTests(ThrottleMixin, TestCase):
    def google(self, token_claims=None, error=None):
        with patch('server.api.views.verify_google_credential', return_value=token_claims, side_effect=error):
            return self.post('/auth/google', {'credential': CREDENTIAL}).status_code

    def test_cp37_twelve_students_on_one_network_all_sign_in(self):
        statuses = [self.google(claims(email=f'student{n}@iitgn.ac.in', sub=str(n))) for n in range(12)]
        self.assertEqual(statuses, [201] * 12)  # 12 first sign-ins, 0 failures: nothing to throttle

    def test_cp37_failed_google_sign_ins_are_still_stopped_after_ten(self):
        for n in range(11):
            self.assertEqual(self.google(claims(email=f'student{n}@iitgn.ac.in', sub=str(n))), 201)
        statuses = [self.google(error=ValueError('bad')) for _ in range(11)]
        self.assertEqual(statuses, [401] * 10 + [429])  # the 11 earlier successes leave the full 10-failure allowance, no more
        self.assertEqual(self.google(claims(email='late@iitgn.ac.in')), 429)  # once locked, a valid token waits too


class PasswordSignInThrottleTests(ThrottleMixin, TestCase):
    def setUp(self):
        for name in ('alpha', 'beta'):
            AcademicRecord.objects.create(owner=User.objects.create_user(username=name, password=self.password))

    def login(self, name='alpha', password=None):
        return self.post('/auth/login', {'username': name, 'password': password or self.password}).status_code

    def test_cp32_successful_logins_from_one_address_never_lock_it(self):
        self.assertEqual([self.login(('alpha', 'beta')[n % 2]) for n in range(12)], [200] * 12)

    def test_cp32_a_success_does_not_wipe_earlier_failures(self):
        # 5 guesses + own-account login + 5 guesses = 10 failures, so the next attempt is the 11th failure-counted one and waits.
        # Resetting the count on success would let an attacker with any account guess forever.
        self.assertEqual([self.login('beta', 'wrong-guess') for _ in range(5)], [401] * 5)
        self.assertEqual(self.login('alpha'), 200)
        self.assertEqual([self.login('beta', 'wrong-guess') for _ in range(5)], [401] * 5)
        self.assertEqual(self.login('beta'), 429)  # even the right password waits

    def test_cp32_successful_sign_ups_do_not_lock_out_the_network(self):
        statuses = [self.post('/auth/signup', {'username': f'new-student-{n}', 'password': self.password}).status_code for n in range(12)]
        self.assertEqual(statuses, [201] * 12)
        self.assertEqual(self.login(), 200)

    def test_cp32_successful_deletion_rechecks_do_not_count(self):
        owner = Client()
        self.assertEqual(self.post('/auth/login', {'username': 'alpha', 'password': self.password}, owner).status_code, 200)
        token = owner.cookies['csrftoken'].value
        for revision in range(12):  # each successful delete-my-data clears the record and bumps its revision by one
            response = owner.delete('/api/v1/account/data', data=json.dumps({'expected_revision': revision, 'password': self.password, 'confirm': 'delete my data'}),
                                    content_type='application/json', HTTP_X_CSRFTOKEN=token, REMOTE_ADDR=CAMPUS)
            self.assertEqual(response.status_code, 200, (revision, response.content))
