"""Issue #23 (CP-03, CP-17, D-07): a requirement group counts each child at most up to what that child asks for.

D-07: surplus credits are earned and shown but fill no other requirement, so a surplus in one child never hides a shortfall in another.
The degree total already works this way (degree_audit.degree_progress, contracts.md "each requirement counts at most what it asks for").

Record: the ADV13 p. 23 anchor path (tests/domain/test_curriculum_adv13.py PATH, 170 credits, complete) with
  - HS 191 (2) removed: the mandatory HS 191 is 0 of 2;
  - HS 305 (4) replaced by a synthetic 6-credit HS course: HSS electives = 6 + HS 352 4 = 10 of 8 (neither course reaches 8 alone, and
    open electives are already 16, so both go to HSS electives: surplus 2).
HSS asks for 28: HS 191 0 + HS 192 2 + HS 201 4 + HS 151 4 + HS 221 4 + GE 4 + HSS electives min(10, 8) = 26 counted, 2 remaining, pending.
The plain sum (28 of 28, 0 remaining while pending) is the bug.
"""
import unittest
from tests.domain.test_curriculum_adv13 import PATH, audit, nodes


def rows_with_hss_shortfall_and_surplus():
    rows = [r for r in PATH if r[1] != 'HS 191']
    return [r if r[1] != 'HS 305' else (r[0], 'HS 306', '6', 'A') for r in rows]


class GroupCountedCapTests(unittest.TestCase):
    def test_cp03_a_pending_group_never_counts_a_childs_surplus_toward_its_shortfall(self):
        result = audit(rows_with_hss_shortfall_and_surplus())
        tree = nodes(result['actual'])
        self.assertEqual((tree['hs191']['status'], tree['hs191']['counted_credits']), ('pending', '0'))
        self.assertEqual((tree['hss-other']['counted_credits'], tree['hss-other']['surplus_credits']), ('10', '2'))   # the leaf still shows its surplus
        hss = tree['hss']
        self.assertEqual((hss['status'], hss['required_credits'], hss['counted_credits'], hss['remaining_credits']), ('pending', '28', '26', '2'))
        self.assertEqual(hss['surplus_credits'], '0')

    def test_cp03_group_counts_agree_with_the_degree_total(self):
        # Degree: 170 earned, but HS 191's 2 credits are missing and the 2 surplus credits count nowhere: 170 - 2 = 168 counted, 2 remaining.
        result = audit(rows_with_hss_shortfall_and_surplus())
        self.assertEqual(result['degree']['actual'], {'total_credits': '170', 'counted_credits': '168', 'remaining_credits': '2'})
        groups = sum(int(r['counted_credits']) for r in result['actual'] if r['id'] != 'viva')
        self.assertEqual(groups, 168)

    def test_cp17_a_satisfied_group_still_reports_its_surplus(self):
        # Negative case for "drop the surplus": CS 451 (2) -> CS 617 (4) puts general CSE electives at 12 of 10 (D-07 example in the
        # existing CP-17 test). The group counts 8 + 8 + 10 = 26 of 26, satisfied, and keeps the 2 surplus credits visible.
        result = audit([r if r[1] != 'CS 451' else (r[0], 'CS 617', '4', 'A') for r in PATH])
        tree = nodes(result['actual'])
        self.assertEqual((tree['cse-general']['counted_credits'], tree['cse-general']['surplus_credits']), ('12', '2'))
        group = tree['cse-electives']
        self.assertEqual((group['status'], group['counted_credits'], group['remaining_credits'], group['surplus_credits']), ('satisfied', '26', '0', '2'))
        self.assertTrue(result['complete'])


if __name__ == '__main__':
    unittest.main()
