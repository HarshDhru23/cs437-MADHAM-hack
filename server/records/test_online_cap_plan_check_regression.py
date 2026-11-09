"""D-10, D-41, D-42, D-45 (CP-35, CP-36): online credits above the 8-credit discipline-elective cap (ADV13 p. 15) never cover the general CSE electives.

Record: the ADV13 p. 23 path (tests/domain/test_curriculum_adv13.PATH, 170 counted) minus its general CSE electives (CS 451 2, CS 613 4, CS 614 4:
cse-general needs 10) and its open electives (ME 210, CE 301, EE 311, MSE 401: open electives need 16). 170 - 10 - 16 = 144 counted, 26 remaining.
Its only CS project (CS 299) is the open project, so all 8 credits of the cap are free for online courses.
"""
import json
from decimal import Decimal
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.domain.test_curriculum_adv13 import PATH, record
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))
DROP = {'CS 451', 'CS 613', 'CS 614', 'ME 210', 'CE 301', 'EE 311', 'MSE 401'}


def path_without_electives():
    return [dict(a, user_corrections=[]) for a in record([r for r in PATH if r[1] not in DROP])['attempts']]


def holder(id, requirement, credits, online=False):
    return {'id': id, 'requirement_id': requirement, 'desired_credits': credits, 'label': 'Online course' if online else 'Elective', **({'online': True} if online else {})}


class OnlineCapPlanCheckTests(AccountAPIMixin, TestCase):
    def start(self, attempts):
        self.client = Client()
        self.signup(self.client, 'online-cap-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': attempts})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.revision = saved.json()['data']['revision']

    def check(self, semesters):
        response = self.request(self.client, 'post', '/plans/check', {'record_revision': self.revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def test_cp36_online_credits_over_the_discipline_cap_leave_cse_general_uncovered_and_the_plan_not_valid(self):
        self.start(path_without_electives())
        plan = [{'term_id': '2027-28-SUMMER', 'courses': [], 'placeholders': [holder('o1', 'cse-general', '8', True), holder('o2', 'cse-general', '2', True)]},
                {'term_id': '2028-29-I', 'courses': [], 'placeholders': [holder('oe', 'open-electives', '16')]}]
        result = self.check(plan)
        self.assertEqual(result['degree']['counted_credits'], '144')
        rows = {r['id']: r for r in result['requirements']}
        # Only 8 of the 10 online credits can be discipline electives: cse-general 10 - 8 = 2 uncovered. The other 2 count as open electives,
        # which the 16-credit placeholder already covers (min(16 + 2, 16) = 16 held).
        self.assertEqual((rows['cse-general']['held_credits'], rows['cse-general']['uncovered_credits']), ('8', '2'))
        self.assertEqual((rows['open-electives']['held_credits'], rows['open-electives']['uncovered_credits']), ('16', '0'))
        self.assertEqual(result['online'], {'planned_credits': '10', 'counted_credits': '10'})
        self.assertEqual(result['status'], {'valid': False, 'problems': 0, 'uncovered_credits': '2'})

    def test_cp36_eight_online_credits_and_two_more_elective_credits_cover_cse_general(self):
        # Negative: the cap is 8, not less, and online courses still count toward cse-general up to it.
        self.start(path_without_electives())
        plan = [{'term_id': '2027-28-SUMMER', 'courses': [], 'placeholders': [holder('o1', 'cse-general', '8', True)]},
                {'term_id': '2028-29-I', 'courses': [], 'placeholders': [holder('ce', 'cse-general', '2'), holder('oe', 'open-electives', '16')]}]
        result = self.check(plan)
        rows = {r['id']: r for r in result['requirements']}
        self.assertEqual((rows['cse-general']['held_credits'], rows['cse-general']['uncovered_credits']), ('10', '0'))
        self.assertEqual(result['status'], {'valid': True, 'problems': 0, 'uncovered_credits': '0'})

    def test_cp35_a_plan_lightened_with_online_courses_puts_at_most_8_online_credits_on_cse_general(self):
        # synthetic_attempts: cse-general needs 10, its CS project is the open project, so at most 8 online credits can be CSE electives.
        self.start(synthetic_attempts())
        generated = self.request(self.client, 'post', '/plans/generate', {'record_revision': self.revision, 'options': {'lighten_with_online': True}}).json()['data']
        online = {}
        for s in generated['semesters']:
            for p in s['placeholders']:
                if p.get('online'):
                    online[p['requirement_id']] = online.get(p['requirement_id'], Decimal(0)) + Decimal(p['desired_credits'])
        self.assertTrue(online, 'the lightened plan uses online credits (D-42)')
        self.assertLessEqual(online.get('cse-general', Decimal(0)), 8, online)
        self.assertTrue(set(online) <= {'cse-general', 'open-electives'}, online)   # D-41: never HSS or Basic Science
        # Every online credit it plans is counted where it is held, so the generated plan checks as valid.
        result = self.check(generated['semesters'])
        self.assertEqual(result['online']['counted_credits'], result['online']['planned_credits'])
        self.assertEqual(result['status'], {'valid': True, 'problems': 0, 'uncovered_credits': '0'})
