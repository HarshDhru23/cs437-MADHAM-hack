"""CR-137: "Try with a sample student". A visitor gets a throw-away account with a made-up record, so the app can be tried without a real transcript or an
IITGN Google account. The account is its own user (nothing is shared with a real student), has no password, cannot take real data in, and is deleted when
the visitor leaves or after a few hours."""
import json
import re
from datetime import timedelta
from pathlib import Path

from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from server.records import demo
from server.records.models import AcademicPlan, AcademicRecord, Attempt, DemoAccount
from server.records.testing import AccountAPIMixin

CLIENT_ID = 'synthetic-client.apps.googleusercontent.com'
SAMPLE = json.loads((Path(__file__).resolve().parents[2] / 'data' / 'demo' / 'sample-student.json').read_text(encoding='utf-8'))


class SampleStudentBase(AccountAPIMixin, TestCase):
    def visitor(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.get('/api/v1/session').status_code, 200)
        return client

    def start(self, client=None):
        client = client or self.visitor()
        return client, self.request(client, 'post', '/auth/demo')

    def session_data(self, client):
        return client.get('/api/v1/session').json()['data']

    def codes(self, response):
        return [issue['code'] for issue in response.json()['issues']]


class StartingTheSampleTests(SampleStudentBase):
    def test_cp37_a_visitor_gets_a_sample_account_with_the_made_up_record(self):
        client, response = self.start()
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertTrue(data['username'].startswith('sample-'))
        self.assertIs(data['demo'], True)
        self.assertEqual(self.session_data(client)['user'], data)
        record = client.get('/api/v1/record').json()['data']
        self.assertEqual(len(record['attempts']), len(SAMPLE['attempts']))
        self.assertEqual(record['revision'], 1)

    def test_cp37_the_audit_and_the_planner_work_on_the_sample(self):
        client, _ = self.start()
        revision = client.get('/api/v1/record').json()['data']['revision']
        analysis = self.request(client, 'post', '/analysis', {'record_revision': revision})
        self.assertEqual(analysis.status_code, 200, analysis.content)
        plan = self.request(client, 'post', '/plans/generate', {'record_revision': revision})
        self.assertEqual(plan.status_code, 200, plan.content)
        self.assertEqual(plan.json()['data']['summary']['remaining_before'], '78')   # 170 - 92 credits of the sample, counted by hand (tests/plan_fixtures.py)

    def test_cp37_the_sample_record_is_plainly_made_up(self):
        for row in SAMPLE['attempts']:
            self.assertTrue(row['title'].startswith('Sample course'), row['title'])
            self.assertTrue(row['id'].startswith('sample-'), row['id'])
        text = json.dumps(SAMPLE)
        self.assertIsNone(re.search(r'\b2\d{7}\b', text), 'a roll-number-shaped number')
        self.assertIsNone(re.search(r'@', text), 'an email address')
        self.assertEqual(sum(int(row['credits']) for row in SAMPLE['attempts']), 92)

    def test_cp37_a_real_account_does_not_show_the_demo_flag(self):
        # Negative: the flag marks only sample accounts.
        client = self.visitor()
        self.signup(client, 'real-student')
        user = self.session_data(client)['user']
        self.assertNotIn('demo', user)

    def test_cp37_the_session_says_the_sample_is_available_and_when_it_is_off(self):
        self.assertIs(self.session_data(self.visitor())['sample_student'], True)
        with override_settings(COURSEPATH_DEMO_ENABLED=False):
            client = self.visitor()
            self.assertIs(self.session_data(client)['sample_student'], False)
            self.assertEqual(self.request(client, 'post', '/auth/demo').status_code, 404)
        self.assertEqual(DemoAccount.objects.count(), 0)

    def test_cp37_the_sample_session_ends_after_the_sample_lifetime(self):
        client, _ = self.start()
        self.assertLessEqual(client.session.get_expiry_age(), 6 * 3600)

    def test_cp37_signing_in_is_refused_for_someone_already_signed_in(self):
        # Negative: pressing the button must not silently replace a real student's session.
        client = self.visitor()
        self.signup(client, 'real-student')
        response = self.request(client, 'post', '/auth/demo')
        self.assertEqual((response.status_code, self.codes(response)), (409, ['ALREADY_SIGNED_IN']))
        self.assertEqual(self.session_data(client)['user']['username'], 'real-student')
        self.assertEqual(DemoAccount.objects.count(), 0)

    def test_cp37_the_csrf_check_applies_to_starting_the_sample(self):
        client = Client(enforce_csrf_checks=True)
        client.get('/api/v1/session')
        bare = client.post('/api/v1/auth/demo', data='{}', content_type='application/json')
        self.assertEqual(bare.status_code, 403)
        self.assertEqual(DemoAccount.objects.count(), 0)


class SampleIsolationTests(SampleStudentBase):
    def test_cp37_every_visitor_gets_their_own_account_and_edits_stay_theirs(self):
        first, _ = self.start()
        second, _ = self.start()
        self.assertEqual(DemoAccount.objects.count(), 2)
        self.assertEqual(AcademicRecord.objects.count(), 2)
        saved = self.request(first, 'patch', '/record', {'expected_revision': 1, 'attempts': []})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(len(first.get('/api/v1/record').json()['data']['attempts']), 0)
        self.assertEqual(len(second.get('/api/v1/record').json()['data']['attempts']), len(SAMPLE['attempts']))

    def test_cp37_a_real_student_is_untouched_by_sample_accounts_and_cannot_see_them(self):
        real = self.visitor()
        self.signup(real, 'real-student')
        saved = self.request(real, 'patch', '/record', {'expected_revision': 0, 'attempts': SAMPLE['attempts'][:2]})
        self.assertEqual(saved.status_code, 200, saved.content)
        sample, _ = self.start()
        self.assertEqual(self.request(sample, 'post', '/plans', {'semesters': []}).status_code, 201)
        self.assertEqual(len(real.get('/api/v1/record').json()['data']['attempts']), 2)
        real_user = User.objects.get(username='real-student')
        self.assertFalse(DemoAccount.objects.filter(owner=real_user).exists())
        self.assertEqual(AcademicPlan.objects.filter(owner=real_user).count(), 0)
        self.assertEqual(Attempt.objects.filter(record__owner=real_user).count(), 2)

    def test_cp37_the_sample_account_cannot_be_signed_in_to_with_a_password(self):
        client, response = self.start()
        username = response.json()['data']['username']
        user = User.objects.get(username=username)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.email, '')
        other = self.visitor()
        for password in ('', 'password', self.password):
            self.assertEqual(self.request(other, 'post', '/auth/login', {'username': username, 'password': password}).status_code, 401)
        self.assertIsNone(self.session_data(other)['user'])


class SampleGuardTests(SampleStudentBase):
    def test_cp37_the_sample_cannot_import_restore_or_delete_data(self):
        client, _ = self.start()
        for method, path, body in [('post', '/imports/preview', {'expected_revision': 1}), ('post', '/imports/backup-preview', {'expected_revision': 1, 'backup': {}}),
                                   ('post', '/imports/00000000-0000-0000-0000-000000000000/commit', {'expected_revision': 1, 'confirm': True}),
                                   ('delete', '/account/data', {'expected_revision': 1, 'confirm': 'delete my data'})]:
            response = self.request(client, method, path, body)
            self.assertEqual((response.status_code, self.codes(response)), (403, ['DEMO_ACCOUNT']), path)
        self.assertEqual(DemoAccount.objects.count(), 1)
        self.assertEqual(len(client.get('/api/v1/record').json()['data']['attempts']), len(SAMPLE['attempts']))

    def test_cp37_a_real_student_still_reaches_those_endpoints(self):
        # Negative: the guard is for sample accounts only; a real student gets the endpoint's own answer, not DEMO_ACCOUNT.
        real = self.visitor()
        self.signup(real, 'real-student')
        for method, path, body in [('post', '/imports/backup-preview', {'expected_revision': 0, 'backup': {}}), ('delete', '/account/data', {'expected_revision': 0})]:
            response = self.request(real, method, path, body)
            self.assertNotIn('DEMO_ACCOUNT', self.codes(response), path)


class SampleCleanupTests(SampleStudentBase):
    def test_cp37_leaving_the_sample_deletes_the_account_and_everything_in_it(self):
        client, response = self.start()
        self.assertEqual(self.request(client, 'post', '/plans', {'semesters': []}).status_code, 201)
        user_id = response.json()['data']['id']
        self.assertEqual(self.request(client, 'post', '/auth/logout').status_code, 200)
        self.assertFalse(User.objects.filter(pk=user_id).exists())
        self.assertEqual((DemoAccount.objects.count(), AcademicRecord.objects.count(), Attempt.objects.count(), AcademicPlan.objects.count()), (0, 0, 0, 0))
        self.assertIsNone(self.session_data(client)['user'])

    def test_cp37_signing_out_of_a_real_account_deletes_nothing(self):
        # Negative: only sample accounts are deleted on leaving.
        client = self.visitor()
        self.signup(client, 'real-student')
        self.assertEqual(self.request(client, 'post', '/auth/logout').status_code, 200)
        self.assertTrue(User.objects.filter(username='real-student').exists())
        self.assertEqual(AcademicRecord.objects.count(), 1)

    def test_cp37_old_sample_accounts_are_purged_when_a_new_one_starts_and_real_ones_are_not(self):
        real = self.visitor()
        self.signup(real, 'real-student')
        _, old = self.start()
        DemoAccount.objects.update(created_at=timezone.now() - timedelta(hours=6, minutes=1))
        recent_client, recent = self.start()
        self.assertFalse(User.objects.filter(pk=old.json()['data']['id']).exists())
        self.assertTrue(User.objects.filter(pk=recent.json()['data']['id']).exists())
        self.assertTrue(User.objects.filter(username='real-student').exists())
        self.assertEqual(DemoAccount.objects.count(), 1)
        self.assertEqual(demo.purge_expired(), 0)

    def test_cp37_a_sample_that_is_not_yet_old_is_kept(self):
        _, first = self.start()
        DemoAccount.objects.update(created_at=timezone.now() - timedelta(hours=5, minutes=59))
        self.start()
        self.assertTrue(User.objects.filter(pk=first.json()['data']['id']).exists())


class SampleLimitTests(SampleStudentBase):
    @override_settings(COURSEPATH_DEMO_MAX=2)
    def test_cp37_too_many_live_samples_is_a_503_and_a_free_place_works_again(self):
        first, _ = self.start()
        self.start()
        refused = self.start()[1]
        self.assertEqual((refused.status_code, self.codes(refused)), (503, ['DEMO_UNAVAILABLE']))
        self.assertEqual(DemoAccount.objects.count(), 2)
        self.request(first, 'post', '/auth/logout')
        self.assertEqual(self.start()[1].status_code, 201)

    def test_cp37_one_address_can_start_thirty_samples_in_fifteen_minutes_and_no_more(self):
        statuses = [self.start()[1].status_code for _ in range(32)]
        self.assertEqual(statuses[:30], [201] * 30)
        self.assertEqual(statuses[30:], [429, 429])

    def test_cp37_starting_samples_does_not_use_up_the_sign_in_failure_allowance(self):
        # Negative: a campus network shares one address; a lecture hall of visitors must not lock real students out of signing in.
        for _ in range(12):
            self.start()
        client = self.visitor()
        statuses = [self.request(client, 'post', '/auth/login', {'username': 'nobody', 'password': 'x'}).status_code for _ in range(3)]
        self.assertEqual(statuses, [401, 401, 401])


@override_settings(COURSEPATH_PRODUCTION=True, COURSEPATH_GOOGLE_CLIENT_ID=CLIENT_ID)
class SampleInProductionTests(SampleStudentBase):
    def test_cp37_in_production_the_sample_works_without_google_and_opens_no_password_path(self):
        client, response = self.start()
        self.assertEqual(response.status_code, 201, response.content)
        username = response.json()['data']['username']
        self.request(client, 'post', '/auth/logout')
        other = self.visitor()
        for path, body in [('/auth/login', {'username': username, 'password': self.password}), ('/auth/signup', {'username': 'anyone@gmail.com', 'password': self.password})]:
            refused = self.request(other, 'post', path, body)
            self.assertEqual((refused.status_code, self.codes(refused)), (403, ['PASSWORD_SIGN_IN_DISABLED']), path)
        self.assertEqual(User.objects.count(), 0)


class SampleContractTests(SampleStudentBase):
    def test_cp37_the_sample_account_and_the_session_match_the_published_schema(self):
        from jsonschema import Draft202012Validator
        schema = json.loads((Path(__file__).resolve().parents[2] / 'schemas' / 'coursepath-v1.schema.json').read_text(encoding='utf-8'))
        account = Draft202012Validator({'$ref': '#/$defs/account', '$defs': schema['$defs']})
        session = Draft202012Validator({'$ref': '#/$defs/session', '$defs': schema['$defs']})
        client, response = self.start()
        account.validate(response.json()['data'])
        session.validate(self.session_data(client))
        session.validate(self.session_data(self.visitor()))   # a signed-out visitor, with and without the sample on
        with override_settings(COURSEPATH_DEMO_ENABLED=False):
            session.validate(self.session_data(self.visitor()))

    def test_cp37_the_schema_refuses_a_demo_flag_that_is_not_true(self):
        # Negative: `demo` is present only as true; a real account carries no flag at all.
        from jsonschema import Draft202012Validator
        schema = json.loads((Path(__file__).resolve().parents[2] / 'schemas' / 'coursepath-v1.schema.json').read_text(encoding='utf-8'))
        account = Draft202012Validator({'$ref': '#/$defs/account', '$defs': schema['$defs']})
        self.assertFalse(account.is_valid({'id': '1', 'username': 'x', 'reauth': 'google', 'demo': False}))
        self.assertTrue(account.is_valid({'id': '1', 'username': 'x', 'reauth': 'google'}))
