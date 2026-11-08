"""Internship evaluation context in /scenarios/compare (issues #12 and #13; CP-33, CP-34, D-04, D-14)."""
from django.test import TestCase
from server.records.testing import AccountAPIMixin


def attempt(i, code, grade, term):
    return {'id': i, 'normalized_code': code, 'original_code': code, 'title': 'Synthetic', 'credits': '4', 'grade': grade, 'term_id': term,
            'completion_status': 'completed', 'learning_designation': 'degree', 'source_refs': [], 'user_corrections': []}


def codes(issues, code):
    return [i['entity_refs'] for i in issues if i['code'] == code]


SUMMER = {'duration_choice': 'three_months', 'preset': 'summer', 'start_date': '2027-05-01', 'end_date_exclusive': '2027-08-01', 'placement_mode': 'onsite_full_time'}
SPRING = {'duration_choice': 'three_months', 'preset': 'custom', 'start_date': '2027-01-31', 'end_date_exclusive': '2027-04-30', 'placement_mode': 'onsite_full_time', 'modules': []}


class InternshipContextTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.signup(self.client, 'intern-context')

    def plan(self, semesters):
        return self.request(self.client, 'post', '/plans', {'semesters': semesters}).json()['data']

    def scenario(self, plan, **payload):
        response = self.request(self.client, 'post', '/scenarios', {'plan_id': plan['id'], **payload})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def compare(self, scenario):
        response = self.request(self.client, 'post', '/scenarios/compare', {'scenario_ids': [scenario['id']]})
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['data']
        return data['comparisons'][0]['scenario']['internship'], data['internship_cases'][0]

    def test_cp34_a_module_aimed_at_a_satisfied_requirement_is_flagged_not_needed(self):
        # D-14: exposure credit goes only where the student still needs it ("if the open project is done, offer no open-project credit").
        modules = [{'id': 'm1', 'credits': '4', 'intended_allocation': 'open_project', 'status': 'proposed'},
                   {'id': 'm2', 'credits': '4', 'intended_allocation': 'open_elective', 'status': 'proposed'}]
        plan = self.plan([{'term_id': '2027-28-I', 'courses': []}])
        scenario = self.scenario(plan, internship={**SUMMER, 'modules': modules})
        # Negative: the empty record leaves the open project (4 credits) and open electives (16) unmet, so neither module is surplus.
        for result in self.compare(scenario):
            self.assertEqual(codes(result['issues'], 'INTERNSHIP_TARGET_NOT_NEEDED'), [])
        # CS 399 matches the open-project pattern ^[A-Z]{2,4} [234]99 (ADV13 p. 2 A.7-A.8, D-10): 4 credits passed - 4 required = 0 remaining.
        moved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': [attempt('h1', 'CS 399', 'A', '2025-26-II')]})
        self.assertEqual(moved.status_code, 200, moved.content)
        scenario = self.request(self.client, 'patch', '/scenarios/' + scenario['id'], {'expected_revision': 0, 'rebase': True}).json()['data']
        for result in self.compare(scenario):
            # m1 is surplus; m2 still fills open electives (16 needed, 0 counted), so it is not flagged.
            self.assertEqual(codes(result['issues'], 'INTERNSHIP_TARGET_NOT_NEEDED'), [['m1']])
            self.assertEqual(codes(result['issues'], 'INTERNSHIP_TARGET_NEED_UNKNOWN'), [])
            self.assertEqual(result['credits']['proposed_by_target'], {'open_project': '4', 'open_elective': '4'})  # a warning, not a rejection

    def test_cp33_internship_case_resolves_course_identity_like_the_scenario(self):
        # CS 322 is ES 214 (D-04), and CS 201 recommends ES 214. The internship overlaps 2026-27-II, so CS 322 is affected and CS 201 is downstream.
        self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': [attempt('h1', 'ES 112', 'A', '2024-25-I')]})
        plan = self.plan([{'term_id': '2026-27-II', 'courses': [{'id': 'old', 'normalized_code': 'CS 322', 'credits': '4'}]},
                          {'term_id': '2027-28-II', 'courses': [{'id': 'toc', 'normalized_code': 'CS 201', 'credits': '4'}]}])
        scenario, case = self.compare(self.scenario(plan, internship=SPRING))
        for result in (scenario, case):
            self.assertEqual((result['affected_courses'], result['downstream_courses']), (['old'], ['toc']))

    def test_cp33_internship_cases_compare_on_the_baseline_plan(self):
        # Contracts section 6: "Compare none/3/6 on equal baseline data". The case table keeps the baseline plan even when the scenario moves
        # courses out of the overlapped term; the scenario's own evaluation sees the moved plan.
        self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': [attempt('h1', 'ES 112', 'A', '2024-25-I')]})
        plan = self.plan([{'term_id': '2026-27-II', 'courses': [{'id': 'old', 'normalized_code': 'CS 322', 'credits': '4'}]},
                          {'term_id': '2027-28-I', 'courses': []},
                          {'term_id': '2027-28-II', 'courses': [{'id': 'toc', 'normalized_code': 'CS 201', 'credits': '4'}]}])
        scenario, case = self.compare(self.scenario(plan, changes=[{'op': 'postpone', 'item_id': 'old', 'term_id': '2027-28-I'}], internship=SPRING))
        self.assertEqual((scenario['affected_courses'], scenario['downstream_courses']), ([], []))
        self.assertEqual((case['affected_courses'], case['downstream_courses']), (['old'], ['toc']))
