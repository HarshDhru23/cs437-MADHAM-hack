"""CP-39 through the API: online courses stay outside a regular semester's load, and a project course added to a plan is placed by the
allocator (open project first, else a discipline elective) without the student saying which."""
import json
from decimal import Decimal
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))


class PlanEditAPITests(AccountAPIMixin, TestCase):
    def start(self, username, attempts):
        client = Client()
        self.signup(client, username)
        saved = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': attempts})
        self.assertEqual(saved.status_code, 200, saved.content)
        return client, saved.json()['data']['revision']

    def check(self, client, revision, semesters):
        response = self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def row(self, data, requirement):
        return next(r for r in data['requirements'] if r['id'] == requirement)

    def test_cp39_online_credits_in_a_full_semester_leave_the_load_and_the_status_alone(self):
        client, revision = self.start('online-load', synthetic_attempts())
        full = [{'id': f'c{n}', 'normalized_code': f'ZZ {100 + n}', 'credits': '4'} for n in range(7)]
        online = [{'id': 'o1', 'requirement_id': 'open-electives', 'desired_credits': '4', 'label': 'Online course', 'online': True}]
        data = self.check(client, revision, [{'term_id': '2026-27-II', 'courses': full, 'placeholders': online}])
        self.assertEqual(data['load']['2026-27-II'], {'planned_credits': '28', 'limit_credits': '28', 'available_credits': '0'})
        self.assertNotIn('LOAD_LIMIT', [i['code'] for i in data['validation']['issues']])
        self.assertEqual(data['online']['planned_credits'], '4')    # still counted in the online pool
        self.assertEqual(data['validation']['workload']['2026-27-II']['online_credits'], '4')

    def test_cp39_a_project_course_fills_the_open_project_when_it_is_still_open(self):
        client, revision = self.start('project-open', synthetic_attempts(without=('CS 299',)))
        plain = self.check(client, revision, [{'term_id': '2026-27-II', 'courses': [], 'placeholders': []}])
        with_project = self.check(client, revision, [{'term_id': '2026-27-II', 'courses': [{'id': 'p1', 'normalized_code': 'CS 399', 'credits': '4'}], 'placeholders': []}])
        self.assertEqual((self.row(plain, 'open-project')['counted_credits'], self.row(plain, 'open-project')['uncovered_credits']), ('0', '4'))
        self.assertEqual((self.row(with_project, 'open-project')['counted_credits'], self.row(with_project, 'open-project')['uncovered_credits']), ('4', '0'))

    def test_cp39_a_second_project_course_counts_as_an_elective_not_as_a_second_open_project(self):
        client, revision = self.start('project-second', synthetic_attempts())   # CS 299 (4 credits) already fills the open project
        before = self.check(client, revision, [{'term_id': '2026-27-II', 'courses': [], 'placeholders': []}])
        after = self.check(client, revision, [{'term_id': '2026-27-II', 'courses': [{'id': 'p1', 'normalized_code': 'CS 399', 'credits': '4'}], 'placeholders': []}])
        self.assertEqual(self.row(after, 'open-project')['counted_credits'], self.row(before, 'open-project')['counted_credits'])
        gained = Decimal(after['degree']['counted_credits']) - Decimal(before['degree']['counted_credits'])
        self.assertEqual(gained, 4)   # the project still counts, in a discipline elective (8-credit cap with online, D-10) or an open elective
