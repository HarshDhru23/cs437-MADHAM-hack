"""Issue #15 (CP-35, D-40): the open-project placeholder is packed into the earliest semester with room, not the emptiest one.

Record: tests/plan_fixtures.py without CS 299. Remaining = 78 (fixture docstring) + 4 (the open project, no longer done) = 82.
At most 28 credits a semester (D-36, D-40), 82 / 28 = 2.93, so the work fits in three semesters (28 + 28 + 26 = 82) and the plan
must end in the third regular term after 2025-26-II, i.e. 2027-28-I, one semester before the usual last term 2027-28-II.
The bug put the 4-credit project alone in 2027-28-II (the emptiest term) although 2027-28-I held 22 (22 + 4 = 26 <= 28).
"""
import json
import unittest
from decimal import Decimal
from coursepath.plan_generation import generate_plan
from tests.domain.test_plan_generation import context
from tests.plan_fixtures import synthetic_attempts

D = Decimal
REGULAR = ['2026-27-I', '2026-27-II', '2027-28-I', '2027-28-II']


def project_holders(result):
    return [(s['term_id'], p['desired_credits']) for s in result['semesters'] for p in s['placeholders']
            if p['requirement_id'] == 'open-project' and not p['label'].startswith('Internship')]


class ProjectPackingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.attempts = synthetic_attempts(without=('CS 299',))
        cls.result = generate_plan(context(cls.attempts))

    def test_cp35_the_project_goes_into_the_earliest_semester_with_room_and_the_plan_ends_a_semester_early(self):
        summary = self.result['summary']
        self.assertEqual(summary['remaining_before'], '82')
        self.assertEqual(project_holders(self.result), [('2027-28-I', '4')])
        self.assertEqual(self.result['graduation']['last_term'], '2027-28-I')   # ceil(82 / 28) = 3 semesters
        self.assertTrue(self.result['graduation']['early'])
        self.assertEqual(summary['credits_by_term'], {'2026-27-I': '28', '2026-27-II': '28', '2027-28-I': '26'})   # 28 + 28 + 26 = 82
        self.assertTrue(summary['complete'])

    def test_cp35_the_project_is_placed_in_the_first_term_where_it_fits(self):
        # every term before the project's own term is too full to take its 4 credits under 28 (D-36)
        term, credits = project_holders(self.result)[0]
        loads = self.result['summary']['credits_by_term']
        for earlier in REGULAR[:REGULAR.index(term)]:
            self.assertGreater(D(loads[earlier]) + D(credits), 28, earlier)
        self.assertLessEqual(D(loads[term]), 28)

    def test_cp35_the_packed_plan_validates_and_stays_deterministic(self):
        self.assertEqual([i for i in self.result['validation']['issues'] if i['severity'] == 'error'], [])
        again = generate_plan(context(synthetic_attempts(without=('CS 299',))))
        self.assertEqual(json.dumps(again, sort_keys=True), json.dumps(self.result, sort_keys=True))

    def test_cp35_a_lightened_plan_keeps_the_project_within_the_lighter_target(self):
        # Negative case for "earliest term under 28, ignoring the target": the lighter plan keeps the packed plan's end (2027-28-I),
        # puts 10 online credits in the 2026-27 summer (its limit, D-41) and spreads the other 82 - 10 = 72 evenly: 72 / 3 = 24 a semester.
        # Putting the project in the first term under 28 would make 2026-27-I 28 and the plan would not be lighter at all.
        lighter = generate_plan(context(self.attempts), {'lighten_with_online': True})
        self.assertTrue(lighter['online_potential']['lightened'])
        self.assertEqual(lighter['summary']['credits_by_term'], {'2026-27-I': '24', '2026-27-II': '24', '2026-27-SUMMER': '10', '2027-28-I': '24'})
        self.assertEqual(project_holders(lighter), [('2027-28-I', '4')])
        self.assertEqual([i for i in lighter['validation']['issues'] if i['severity'] == 'error'], [])


if __name__ == '__main__':
    unittest.main()
