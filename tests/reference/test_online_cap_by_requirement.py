"""D-10, D-13, D-42 (CP-35, CP-36): each planned online credit counts where the allocator puts it, not where the student aimed it.

ADV13 p. 15: online courses and CS projects contribute at most 8 credits as discipline electives (cap `project-online-elective`). Hand count for
tests/plan_fixtures.synthetic_attempts: CS 299 is the open project, so the 8 are unused; cse-general needs 10 and open electives need 16.
"""
import unittest
from decimal import Decimal
from coursepath.online_credits import count_online
from coursepath.rules.loader import load_curriculum
from tests.plan_fixtures import synthetic_attempts

D = Decimal
CURRICULUM = load_curriculum()


def count(*placeholders):
    plan = {'semesters': [{'term_id': '2026-27-SUMMER', 'courses': [], 'placeholders': [
        {'id': f'p{i}', 'requirement_id': requirement, 'desired_credits': credits, 'label': 'Online course', 'online': True} for i, (requirement, credits) in enumerate(placeholders)]}]}
    return count_online(CURRICULUM, {'attempts': synthetic_attempts(), 'current_enrolment': []}, plan)


class OnlineCreditsByRequirement(unittest.TestCase):
    def test_online_credits_over_the_8_credit_discipline_cap_count_as_open_electives_not_cse_general(self):
        # 10 aimed at cse-general: 8 fit under the cap, the other 2 count as open electives (D-13), so cse-general gets 8, not 10.
        result = count(('cse-general', '10'))
        self.assertEqual(result.get('counted_by_requirement'), {'cse-general': D(8), 'open-electives': D(2)})
        self.assertEqual(result['counted'], D(10))   # all 10 still count toward the degree; no ONLINE_CREDIT_LIMIT warning
        self.assertEqual(result['issues'], [])

    def test_online_credits_within_the_cap_stay_in_cse_general(self):
        # Negative: 8 is exactly the cap, so nothing moves to the open electives.
        self.assertEqual(count(('cse-general', '8')).get('counted_by_requirement'), {'cse-general': D(8)})

    def test_an_online_course_aimed_at_a_required_course_counts_only_as_an_open_elective(self):
        # D-42: online courses are for HSS electives, the Basic Science elective, general CSE electives and open electives. One aimed at
        # Theory of Computing (CS 201) or the Theory basket (a fixed list, ADV13 p. 15) cannot fill it; the allocator counts it as an open elective.
        self.assertEqual(count(('toc', '4')).get('counted_by_requirement'), {'open-electives': D(4)})
        self.assertEqual(count(('theory', '4')).get('counted_by_requirement'), {'open-electives': D(4)})
        # Negative: HSS electives may be taken online (D-42).
        self.assertEqual(count(('hss-other', '8')).get('counted_by_requirement'), {'hss-other': D(8)})


if __name__ == '__main__':
    unittest.main()
