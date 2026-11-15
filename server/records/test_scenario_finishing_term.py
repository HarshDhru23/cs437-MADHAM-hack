"""Issue #156 (CP-50, CP-28): "You finish" shows the server's finishing term. The finishing term of a plan is the last semester that holds any of its
credits, given only when the plan leaves no degree credit uncovered (the same count as the plan's "Valid" status, D-45); otherwise it is null, never a
guess. The test goes through the real POST /scenarios/compare, not a fixture.

The plan is the generated draft for the synthetic record, which is complete (test_plan_status). Its last semester is read from the plan itself."""
import json
from django.test import Client, TestCase
from coursepath.models import term_key
from server.records.testing import AccountAPIMixin
from tests.plan_fixtures import synthetic_attempts

LATER = '2031-32-I'   # a regular semester after any semester of the generated plan


def credited(semester):
    return any(c['credits'] not in ('0',) for c in semester['courses']) or any(p['desired_credits'] not in ('0',) for p in semester.get('placeholders', []))


class ScenarioFinishingTermTests(AccountAPIMixin, TestCase):
    def setUp(self):
        self.client = Client()
        self.signup(self.client, 'finishing-student')
        saved = self.request(self.client, 'patch', '/record', {'expected_revision': 0, 'attempts': synthetic_attempts()})
        self.assertEqual(saved.status_code, 200, saved.content)
        generated = self.request(self.client, 'post', '/plans/generate', {'record_revision': saved.json()['data']['revision']}).json()['data']
        self.assertTrue(generated['summary']['complete'])
        created = self.request(self.client, 'post', '/plans', {'label': 'Finish', 'semesters': generated['semesters']})
        self.assertEqual(created.status_code, 201, created.content)
        self.plan = created.json()['data']
        terms = sorted((s for s in self.plan['semesters'] if credited(s)), key=lambda s: term_key(s['term_id']))
        self.last = terms[-1]
        self.assertLess(term_key(self.last['term_id']), term_key(LATER))

    def compare(self, changes):
        scenario = self.request(self.client, 'post', '/scenarios', {'plan_id': self.plan['id'], 'label': 'What if', 'changes': changes})
        self.assertEqual(scenario.status_code, 201, scenario.content)
        response = self.request(self.client, 'post', '/scenarios/compare', {'scenario_ids': [scenario.json()['data']['id']]})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['data']['comparisons'][0]

    def a_course_in_the_last_semester(self):
        """The latest planned course with credits (the last semester may hold only placeholders, which a scenario cannot postpone)."""
        with_courses = [s for s in self.plan['semesters'] if any(c['credits'] not in ('0',) for c in s['courses'])]
        latest = max(with_courses, key=lambda s: term_key(s['term_id']))
        return next(c for c in latest['courses'] if c['credits'] not in ('0',))

    def test_cp50_the_baseline_finishes_in_the_last_semester_of_the_plan(self):
        comparison = self.compare([])
        self.assertEqual(comparison['baseline']['completion_term'], self.last['term_id'])
        self.assertEqual(comparison['scenario']['completion_term'], self.last['term_id'])

    def test_cp50_postponing_a_final_year_course_past_the_last_semester_finishes_later(self):
        course = self.a_course_in_the_last_semester()
        comparison = self.compare([{'op': 'postpone', 'item_id': course['id'], 'term_id': LATER}])
        self.assertEqual(comparison['baseline']['completion_term'], self.last['term_id'])
        self.assertEqual(comparison['scenario']['completion_term'], LATER)

    def test_cp50_a_plan_that_no_longer_covers_the_degree_has_no_finishing_term(self):
        course = self.a_course_in_the_last_semester()
        comparison = self.compare([{'op': 'drop', 'item_id': course['id']}])
        self.assertIsNone(comparison['scenario']['completion_term'])
        self.assertEqual(comparison['baseline']['completion_term'], self.last['term_id'])
