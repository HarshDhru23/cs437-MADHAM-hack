"""CP-47: a student who earns or plans more credits than the degree asks for sees it, for example 172 of 170, not a total quietly held at 170.

Each requirement still counts at most what it asks for (D-07), so `counted_credits` stays at most 170 and `remaining_credits` at least 0; the credits beyond
what a requirement asks for are the degree's `surplus_credits`, and counted plus surplus is every credit the student has toward the degree.

Expected values are counted by hand from the ADV13 p. 23 anchor path (tests/domain/test_curriculum_adv13.py: 170 credits, complete): replacing CS 451 (2
credits) by a 4-credit CSE elective puts general CSE electives at 12 of 10, so 2 credits are beyond the 10 and 172 are earned."""
import unittest
from decimal import Decimal

from tests.domain.test_curriculum_adv13 import PATH, audit


def more_than_asked():
    return [r if r[1] != 'CS 451' else (r[0], 'CS 617', '4', 'A') for r in PATH]


class DegreeSurplusTests(unittest.TestCase):
    def test_cp47_a_complete_record_at_exactly_170_has_no_surplus(self):
        result = audit(PATH)
        self.assertEqual(result['degree']['actual'], {'total_credits': '170', 'counted_credits': '170', 'remaining_credits': '0'})
        self.assertEqual(result['degree_surplus']['actual'], {'surplus_credits': '0', 'earned_credits': '170'})

    def test_cp47_credits_beyond_what_a_requirement_asks_for_are_reported_as_surplus(self):
        result = audit(more_than_asked())
        self.assertEqual(result['degree_surplus']['actual'], {'surplus_credits': '2', 'earned_credits': '172'})
        self.assertEqual(result['degree']['actual'], {'total_credits': '170', 'counted_credits': '170', 'remaining_credits': '0'})   # the count itself stays at the total

    def test_cp47_the_counted_credits_and_the_remaining_credits_never_pass_the_total(self):
        degree = audit(more_than_asked())['degree']['actual']
        self.assertLessEqual(Decimal(degree['counted_credits']), Decimal(degree['total_credits']))
        self.assertGreaterEqual(Decimal(degree['remaining_credits']), 0)

    def test_cp47_surplus_in_one_requirement_does_not_hide_a_shortfall_in_another(self):
        # HS 191 (2 credits) is missing and the CSE electives are over by 2: 170 - 2 counted, 2 remaining, and the 2 extra credits are shown as extra.
        rows = [r for r in more_than_asked() if r[1] != 'HS 191']
        result = audit(rows)
        degree, extra = result['degree']['actual'], result['degree_surplus']['actual']
        self.assertEqual((degree['counted_credits'], degree['remaining_credits'], extra['surplus_credits'], extra['earned_credits']), ('168', '2', '2', '170'))

    def test_cp47_the_current_and_projected_views_report_it_too(self):
        result = audit(more_than_asked())
        for view in ('current', 'projected'):
            with self.subTest(view=view):
                self.assertEqual(result['degree_surplus'][view], {'surplus_credits': '2', 'earned_credits': '172'})

    def test_cp47_a_requirement_group_is_not_counted_twice(self):
        # Negative: the surplus is summed over the requirements that earn it once, not once for the leaf and again for every group above it.
        self.assertEqual(audit(more_than_asked())['degree_surplus']['actual']['surplus_credits'], '2')


if __name__ == '__main__':
    unittest.main()
