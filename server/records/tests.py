from django.test import TestCase, Client
from server.records.testing import AccountAPIMixin


class AccountPersistenceTests(AccountAPIMixin, TestCase):

    def test_cp29_second_device_save_reload_conflict_and_logout(self):
        first, second = Client(enforce_csrf_checks=True), Client(enforce_csrf_checks=True)
        self.signup(first, 'synthetic-one')
        second.get('/api/v1/session')
        self.assertEqual(self.request(second, 'post', '/auth/login', {'username': 'synthetic-one', 'password': self.password}).status_code, 200)
        self.assertEqual(self.request(first, 'patch', '/record', {'expected_revision': 0, 'attempts': []}).status_code, 200)
        self.assertEqual(second.get('/api/v1/record').json()['data']['revision'], 1)
        conflict = self.request(second, 'patch', '/record', {'expected_revision': 0, 'attempts': []})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['data']['current_revision'], 1)
        self.assertEqual(self.request(second, 'post', '/auth/logout').status_code, 200)
        self.assertEqual(second.get('/api/v1/record').status_code, 401)

    def test_account_csrf_password_duplicate_and_throttle(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.post('/api/v1/auth/signup', data='{}', content_type='application/json').status_code, 403)
        self.signup(client, 'synthetic-two')
        self.assertEqual(self.request(client, 'post', '/auth/signup', {'username': 'synthetic-two', 'password': self.password}).status_code, 400)
        self.assertEqual(self.request(client, 'post', '/auth/password', {'old_password': 'bad', 'new_password': '123'}).status_code, 400)
        bad = Client(enforce_csrf_checks=True)
        bad.get('/api/v1/session')
        statuses = [self.request(bad, 'post', '/auth/login', {'username': 'synthetic-two', 'password': 'bad'}).status_code for _ in range(11)]
        self.assertIn(429, statuses)

    def test_two_user_plan_isolation_revision_and_invalid_profile(self):
        owner, foreign = Client(), Client()
        self.signup(owner, 'owner')
        self.signup(foreign, 'foreign')
        plan = self.request(owner, 'post', '/plans', {'semesters': []}).json()['data']
        self.assertEqual(foreign.get('/api/v1/plans/' + plan['id']).status_code, 404)
        self.assertEqual(self.request(foreign, 'patch', '/plans/' + plan['id'], {'expected_revision': 0, 'semesters': []}).status_code, 404)
        self.assertEqual(self.request(owner, 'patch', '/plans/' + plan['id'], {'expected_revision': 0, 'semesters': []}).status_code, 200)
        self.assertEqual(self.request(owner, 'patch', '/plans/' + plan['id'], {'expected_revision': 0, 'semesters': []}).status_code, 409)
        self.assertEqual(self.request(owner, 'patch', '/record', {'expected_revision': 0, 'profile': {'admission_year': 2025}}).status_code, 400)
        self.assertEqual(self.request(owner, 'patch', '/record', {'expected_revision': 0, 'approvals': [{'status': 'verified'}]}).status_code, 400)

    def test_malformed_json_and_unsupported_methods(self):
        client = Client()
        self.signup(client, 'malformed')
        self.assertEqual(client.get('/api/v1/session').get('X-Frame-Options'), 'DENY')
        self.assertEqual(client.patch('/api/v1/record', data='[', content_type='application/json').status_code, 400)
        self.assertEqual(client.delete('/api/v1/record').status_code, 405)

    def test_password_change_invalidates_other_device(self):
        first, second = Client(), Client()
        self.signup(first, 'password-owner')
        self.request(second, 'post', '/auth/login', {'username': 'password-owner', 'password': self.password})
        self.assertEqual(self.request(first, 'post', '/auth/password', {'old_password': self.password, 'new_password': 'Different-river-847!'}).status_code, 200)
        self.assertEqual(first.get('/api/v1/record').status_code, 200)
        self.assertEqual(second.get('/api/v1/record').status_code, 401)
