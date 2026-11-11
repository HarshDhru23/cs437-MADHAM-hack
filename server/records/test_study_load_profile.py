"""CP-44 (D-56, issue #115): a student records their own standing (regular or GPS) and an optional advisor credit cap, by self-declaration, with
`PATCH /record`. The other profile fields stay fixed (curriculum changes need review). The two values reach the saved-plan validation (ADV13 p. 7,
D-36) and never a draft check, which keeps its one 28-credit limit. Expected limits come from the decision: GPS 21, advisor cap 1 to 28."""
from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts


def term(credits_each, count):
    return [{'term_id': '2026-27-I', 'courses': [{'id': f'c{n}', 'normalized_code': f'ZZ {300 + n}', 'credits': credits_each} for n in range(count)], 'placeholders': []}]


class StudyLoadProfileTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'load-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.record = saved.json()['data']

    def declare(self, **changes):
        profile = {**self.record['profile'], **changes}
        return self.request(self.client, 'patch', '/record', {'expected_revision': self.record['revision'], 'profile': profile})

    def current(self):
        return self.client.get('/api/v1/record').json()['data']

    def limit_issues(self, data):
        return [i for i in data['validation']['issues'] if i['code'] == 'LOAD_LIMIT']

    def save_plan(self, semesters):
        response = self.request(self.client, 'post', '/plans', {'semesters': semesters, 'label': 'Load'})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def test_cp44_a_student_declares_standing_and_an_advisor_cap_and_the_record_keeps_them(self):
        response = self.declare(standing='GPS', advisor_cap='24')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['data']
        self.assertEqual((data['profile']['standing'], data['profile']['advisor_cap']), ('GPS', '24'))
        self.assertEqual(data['revision'], self.record['revision'] + 1)
        self.assertEqual(self.current()['profile']['advisor_cap'], '24')
        self.assertEqual(len(self.current()['attempts']), len(self.record['attempts']))   # nothing else on the record changes

    def test_cp44_an_advisor_cap_the_student_set_limits_a_saved_plan(self):
        self.assertEqual(self.declare(advisor_cap='24').status_code, 200)
        issues = self.limit_issues(self.save_plan(term('5', 5)))   # 25 credits over a 24-credit cap
        self.assertEqual([i['message'] for i in issues], ['Target workload exceeds the 24-credit limit.'])

    def test_cp44_gps_standing_limits_a_saved_plan_to_21_credits(self):
        self.assertEqual(self.declare(standing='GPS').status_code, 200)
        self.assertEqual(len(self.limit_issues(self.save_plan(term('4', 6)))), 1)   # 24 credits over 21
        self.assertEqual(self.limit_issues(self.save_plan(term('3', 7))), [])        # 21 credits is fine

    def test_cp44_a_draft_check_keeps_its_single_28_credit_limit(self):
        self.assertEqual(self.declare(standing='GPS', advisor_cap='20').status_code, 200)
        revision = self.current()['revision']
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': revision, 'semesters': term('4', 6)})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.limit_issues(response.json()['data']), [])

    def test_cp44_the_cap_can_be_taken_away_again(self):
        self.assertEqual(self.declare(advisor_cap='24').status_code, 200)
        self.record = self.current()
        response = self.request(self.client, 'patch', '/record', {'expected_revision': self.record['revision'], 'profile': {k: v for k, v in self.record['profile'].items() if k != 'advisor_cap'}})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn('advisor_cap', response.json()['data']['profile'])
        self.assertEqual(self.limit_issues(self.save_plan(term('5', 5))), [])

    def test_cp44_a_cap_outside_1_to_28_whole_credits_is_refused_and_nothing_changes(self):
        for bad in ('0', '29', '24.5', '-4', 'abc', '', 24, True, None):
            with self.subTest(cap=bad):
                response = self.declare(advisor_cap=bad)
                self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(self.current()['revision'], self.record['revision'])
        self.assertNotIn('advisor_cap', self.current()['profile'])

    def test_cp44_the_limits_of_the_range_are_accepted(self):
        for ok in ('1', '28'):
            with self.subTest(cap=ok):
                response = self.declare(advisor_cap=ok)
                self.assertEqual(response.status_code, 200, response.content)
                self.record = response.json()['data']

    def test_cp44_standing_is_regular_or_gps_only(self):
        for bad in ('wizard', 'gps', '', 'unknown', 3, None):
            with self.subTest(standing=bad):
                self.assertEqual(self.declare(standing=bad).status_code, 400)
        self.assertEqual(self.declare(standing='normal').status_code, 200)

    def test_cp44_curriculum_fields_still_need_review(self):
        for field, value in (('programme', 'BTECH_EE'), ('admission_year', 2023), ('curriculum_version', 'cse-2023-v1')):
            with self.subTest(field=field):
                response = self.declare(**{field: value})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.declare(standing='GPS', mystery='x').status_code, 400)   # no other profile field is accepted

    def test_cp44_a_stale_revision_is_a_409_and_changes_nothing(self):
        self.assertEqual(self.declare(advisor_cap='24').status_code, 200)
        stale = self.request(self.client, 'patch', '/record', {'expected_revision': self.record['revision'], 'profile': {**self.record['profile'], 'advisor_cap': '12'}})
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(self.current()['profile']['advisor_cap'], '24')

    def test_cp44_a_student_only_changes_their_own_profile(self):
        self.assertEqual(self.declare(standing='GPS', advisor_cap='20').status_code, 200)
        other = Client()
        self.signup(other, 'other-student')
        profile = other.get('/api/v1/record').json()['data']['profile']
        self.assertNotIn('advisor_cap', profile)
        self.assertNotEqual(profile.get('standing'), 'GPS')

    def test_cp44_the_export_carries_what_the_student_declared(self):
        self.assertEqual(self.declare(standing='GPS', advisor_cap='24').status_code, 200)
        exported = self.client.get('/api/v1/export').json()['data']
        self.assertEqual((exported['record']['profile']['standing'], exported['record']['profile']['advisor_cap']), ('GPS', '24'))


if __name__ == '__main__':
    import unittest
    unittest.main()
