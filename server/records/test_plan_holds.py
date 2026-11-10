"""CP-40 (D-53): the requirements view "With my plan" counts the credits a plan keeps in placeholders and says which placeholder keeps them.

Expected numbers are counted by hand from tests/plan_fixtures.py: 92 of 170 degree credits are completed, so 78 remain; a 4-credit open-elective
placeholder and a 4-credit HSS-elective placeholder keep 8 of them (100 counted, 70 remaining); open electives need 16 and HSS electives 8, so a
20-credit open-elective placeholder keeps no more than the 16 the requirement can still take."""
import json
from pathlib import Path
from django.test import Client, TestCase
from jsonschema import Draft202012Validator, FormatChecker
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'schemas/coursepath-v1.schema.json').read_text(encoding='utf-8'))


def holder(pid, requirement, credits, label='Placeholder', **extra):
    return {'id': pid, 'requirement_id': requirement, 'desired_credits': credits, 'label': label, **extra}


class PlanHoldsTests(AccountAPIMixin, TestCase):
    def analysis(self, username, placeholders, courses=()):
        client = Client()
        self.signup(client, username)
        saved = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        revision = saved.json()['data']['revision']
        semesters = [{'term_id': '2026-27-I', 'courses': list(courses), 'placeholders': list(placeholders)}]
        plan = self.request(client, 'post', '/plans', {'label': 'p', 'semesters': semesters}).json()['data']
        response = self.request(client, 'post', '/analysis', {'record_revision': revision, 'plan_id': plan['id'], 'plan_revision': plan['revision']})
        self.assertEqual(response.status_code, 200, response.content)
        Draft202012Validator(SCHEMA, format_checker=FormatChecker()).validate(response.json())
        return response.json()['data']

    def test_cp40_placeholder_credits_count_toward_the_total_with_the_plan(self):
        data = self.analysis('holds-total', [holder('p1', 'open-electives', '4', 'Open elective'), holder('p2', 'hss-other', '4', 'HSS elective')])
        self.assertEqual(data['audit']['degree']['projected']['counted_credits'], '92')   # the plan's courses alone: none
        holds = data['plan_holds']
        self.assertEqual(holds['degree'], {'held_credits': '8', 'counted_credits': '100', 'remaining_credits': '70', 'total_credits': '170'})

    def test_cp40_each_requirement_says_how_much_is_kept_and_by_which_placeholder(self):
        data = self.analysis('holds-rows', [holder('p1', 'open-electives', '4', 'Open elective'), holder('p2', 'hss-other', '4', 'HSS elective')])
        rows = data['plan_holds']['requirements']
        self.assertEqual(rows['open-electives']['held_credits'], '4')
        self.assertEqual([(p['id'], p['label'], p['desired_credits'], p['term_id']) for p in rows['open-electives']['placeholders']], [('p1', 'Open elective', '4', '2026-27-I')])
        self.assertEqual(rows['hss-other']['held_credits'], '4')
        self.assertEqual(rows['hss']['held_credits'], '4')            # the group that holds the HSS electives
        self.assertEqual(rows['hss']['placeholders'], [])             # the placeholder itself is named only on its own requirement
        self.assertNotIn('theory', rows)                              # nothing is kept for a requirement no placeholder names

    def test_cp40_a_placeholder_keeps_no_more_than_the_requirement_can_still_take(self):
        data = self.analysis('holds-cap', [holder('p1', 'open-electives', '20', 'Open elective')])
        rows = data['plan_holds']['requirements']
        self.assertEqual(rows['open-electives']['held_credits'], '16')   # 16 required, none counted yet
        self.assertEqual(data['plan_holds']['degree']['held_credits'], '16')
        self.assertEqual(data['plan_holds']['degree']['counted_credits'], '108')   # 92 + 16, not 92 + 20
        self.assertEqual([p['id'] for p in rows['open-electives']['placeholders']], ['p1'])

    def test_cp40_an_online_placeholder_is_kept_where_the_allocator_counts_it(self):
        data = self.analysis('holds-online', [holder('o1', 'open-electives', '4', 'Online course', online=True)])
        row = data['plan_holds']['requirements']['open-electives']
        self.assertEqual(row['held_credits'], '4')
        self.assertTrue(row['placeholders'][0]['online'])

    def test_cp40_a_plan_without_placeholders_keeps_nothing(self):
        data = self.analysis('holds-none', [], courses=[{'id': 'c1', 'normalized_code': 'ZZ 301', 'credits': '4'}])
        self.assertEqual(data['plan_holds']['requirements'], {})
        self.assertEqual(data['plan_holds']['degree']['held_credits'], '0')
        self.assertEqual(data['plan_holds']['degree']['counted_credits'], data['audit']['degree']['projected']['counted_credits'])

    def test_cp40_without_a_plan_there_are_no_holds(self):
        client = Client()
        self.signup(client, 'holds-noplan')
        data = self.request(client, 'post', '/analysis', {'record_revision': 0}).json()['data']
        self.assertIsNone(data.get('plan_holds'))


class PlanHoldsAgreeWithThePlanCheckTests(AccountAPIMixin, TestCase):
    """The requirements view and the plan check count the same placeholders, so what the view says is left is what the check says is uncovered."""

    CASES = {
        'none': [],
        'two': [holder('p1', 'open-electives', '4', 'Open elective'), holder('p2', 'hss-other', '4', 'HSS elective')],
        'capped': [holder('p1', 'open-electives', '20', 'Open elective')],
        'two-over': [holder('p1', 'open-electives', '10', 'a'), holder('p2', 'open-electives', '10', 'b')],
        'online-over-the-discipline-cap': [holder('o1', 'cse-general', '20', 'Online course', online=True)],
        'met-requirement': [holder('p1', 'dsa', '4', 'Aimed at a course already passed')],
        'group': [holder('p1', 'hss', '4', 'Aimed at a group')],
    }

    analysis = PlanHoldsTests.analysis   # the same helper, without re-running that class's tests

    def check(self, username, placeholders):
        client = Client()
        self.signup(client, username)
        revision = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()}).json()['data']['revision']
        semesters = [{'term_id': '2026-27-I', 'courses': [], 'placeholders': placeholders}]
        response = self.request(client, 'post', '/plans/check', {'record_revision': revision, 'semesters': semesters})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['data']

    def test_cp40_the_remaining_credits_equal_the_plan_checks_uncovered_credits_in_every_case(self):
        for name, placeholders in self.CASES.items():
            with self.subTest(case=name):
                holds = self.analysis(f'agree-{name}', placeholders)['plan_holds']['degree']
                checked = self.check(f'agree-check-{name}', placeholders)
                self.assertEqual(holds['remaining_credits'], checked['uncovered_credits'])

    def test_cp40_two_open_elective_placeholders_keep_what_the_requirement_can_take_and_are_both_named(self):
        row = self.analysis('holds-two-over', self.CASES['two-over'])['plan_holds']['requirements']['open-electives']
        self.assertEqual(row['held_credits'], '16')   # 20 asked for, 16 needed
        self.assertEqual(sorted(p['id'] for p in row['placeholders']), ['p1', 'p2'])

    def test_cp40_a_placeholder_aimed_at_a_requirement_that_is_already_met_keeps_nothing(self):
        data = self.analysis('holds-met', self.CASES['met-requirement'])['plan_holds']
        self.assertEqual(data['degree']['held_credits'], '0')
        self.assertEqual(data['requirements'].get('dsa', {'held_credits': '0'})['held_credits'], '0')

    def test_cp40_online_credits_over_the_discipline_cap_are_kept_up_to_the_cap_only(self):
        data = self.analysis('holds-online-cap', self.CASES['online-over-the-discipline-cap'])['plan_holds']
        rows = data['requirements']
        self.assertEqual(rows['cse-general']['held_credits'], '8')   # the 8-credit cap on online credits in the discipline electives (D-11)
        self.assertLessEqual(float(data['degree']['held_credits']), 20)


class CurrentCoursesCountTests(AccountAPIMixin, TestCase):
    """CP-41: a confirmed current course is counted in "Completed + current courses" under the requirement it fills; the record only accepts confirmed ones.
    92 of 170 credits are completed (tests/plan_fixtures.py); CS 330 (4 credits) fills the pending Operating Systems core course, so 96 count."""

    def analysis(self, username, enrolment):
        client = Client()
        self.signup(client, username)
        saved = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts(), 'current_enrolment': enrolment})
        self.assertEqual(saved.status_code, 200, saved.content)
        response = self.request(client, 'post', '/analysis', {'record_revision': saved.json()['data']['revision']})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['data']['audit']

    def test_cp41_a_confirmed_current_course_counts_under_its_requirement(self):
        row = {'id': 'ce-os', 'normalized_code': 'CS 330', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True}
        audit = self.analysis('current-counts', [row])
        self.assertEqual(audit['degree']['actual']['counted_credits'], '92')
        self.assertEqual(audit['degree']['current']['counted_credits'], '96')
        self.assertEqual([(a['attempt_id'], a['requirement_id']) for a in audit['current_ledger'] if a['attempt_id'] == 'ce-os'], [('ce-os', 'os')])

    def test_cp41_without_current_courses_the_current_count_equals_the_completed_count(self):
        audit = self.analysis('current-none', [])
        self.assertEqual(audit['degree']['current']['counted_credits'], audit['degree']['actual']['counted_credits'])
        self.assertEqual(audit['current_ledger'], audit['ledger'])

    def test_cp41_a_current_course_that_is_not_confirmed_is_refused(self):
        client = Client()
        self.signup(client, 'current-refused')
        row = {'id': 'ce-os', 'normalized_code': 'CS 330', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': False}
        response = self.request(client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts(), 'current_enrolment': [row]})
        self.assertEqual(response.status_code, 400)
