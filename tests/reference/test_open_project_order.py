"""Issue #16 (CP-17, CP-18, D-10): the open project is the first passed project course taken after the first year.

Record: the ADV13 p. 23 anchor path (tests/domain/test_curriculum_adv13.py PATH, 170 credits, CS 299 passed in 2026-27-I). Each case
swaps one course for another of the same credits, so the record still earns 170, and a complete allocation exists both with the
first project on the open project and with another one there. D-10 picks among such equal allocations; D-07 (the most requirements
and credits counted) still comes first, so the D-10 order never makes the degree count less.
"""
import unittest
from tests.domain.test_curriculum_adv13 import PATH, audit


def swap(rows, old, new):
    return [new if r[1] == old else r for r in rows]


def placed(result):
    return {a['attempt_id']: a['requirement_id'] for a in result['ledger']}


class OpenProjectOrderTests(unittest.TestCase):
    def assertComplete170(self, result):
        self.assertTrue(result['complete'])
        self.assertEqual(result['degree']['actual']['counted_credits'], '170')

    def test_cp18_the_first_passed_project_is_the_open_project_and_a_later_one_goes_on(self):
        # ME 210 (open elective, 4) -> EE 399 passed in 2027-28-I (4). CS 299 (2026-27-I) comes first, so it is the open project (D-10 step 1);
        # EE 399 is not CS-coded, so it cannot be a discipline elective (D-06) and goes to open electives (step 3), in ME 210's place.
        # General CSE electives keep CS 451 2 + CS 613 4 + CS 614 4 = 10; the degree stays 170.
        result = audit(swap(PATH, 'ME 210', (6, 'EE 399', '4', 'A')))
        self.assertComplete170(result)
        ledger = placed(result)
        self.assertEqual((ledger['a39-CS 299'], ledger['a51-EE 399'], ledger['a54-CS 614']), ('open-project', 'open-electives', 'cse-general'))

    def test_cp18_an_earlier_project_from_another_discipline_is_the_open_project(self):
        # Negative case for "prefer a CS project" or "prefer the lower attempt id": EE 399 passed in 2025-26-II, before CS 299 (2026-27-I).
        result = audit(swap(PATH, 'ME 210', (3, 'EE 399', '4', 'A')))
        self.assertComplete170(result)
        ledger = placed(result)
        self.assertEqual(ledger['a51-EE 399'], 'open-project')
        self.assertNotEqual(ledger['a39-CS 299'], 'open-project')

    def test_cp18_of_two_cs299_registrations_the_earlier_one_is_the_open_project(self):
        # D-10: "the first CS 299 is the open project and the second is a discipline elective". CS 614 (4) is replaced by a second CS 299
        # passed in 2025-26-I, listed last (attempt a59) but taken before the 2026-27-I one (a39).
        # General CSE electives: CS 451 2 + CS 613 4 + the later CS 299 4 = 10 (8-credit project/online cap, p. 15); the degree stays 170.
        result = audit([r for r in PATH if r[1] != 'CS 614'] + [(2, 'CS 299', '4', 'B')])
        self.assertComplete170(result)
        ledger = placed(result)
        self.assertEqual((ledger['a59-CS 299'], ledger['a39-CS 299']), ('open-project', 'cse-general'))

    def test_cp17_the_project_order_never_makes_the_degree_count_less(self):
        # Negative case for "always put the first project on the open project": CS 614 removed, EE 399 added in 2027-28-I.
        # CS 299 on the open project would leave general CSE electives at CS 451 2 + CS 613 4 = 6 of 10 and EE 399 unneeded (open electives
        # are already 16): 166 counted. EE 399 on the open project and CS 299 as a general CSE elective (2 + 4 + 4 = 10) counts all 170 (D-07).
        result = audit([r for r in PATH if r[1] != 'CS 614'] + [(6, 'EE 399', '4', 'A')])
        self.assertComplete170(result)
        ledger = placed(result)
        self.assertEqual((ledger['a59-EE 399'], ledger['a39-CS 299']), ('open-project', 'cse-general'))


if __name__ == '__main__':
    unittest.main()
