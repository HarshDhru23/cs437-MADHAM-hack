"""D-42 / CP-35, CP-18: which online credits a student plans would count toward the degree. Expected numbers are hand counts from
tests/plan_fixtures.py (78 credits remain: HSS electives 8, open electives 16, CSE electives 10, Basic Science elective 4, ...) and the caps in
data/curricula/cse-2024.json (pool of 16 online credits, 8 shared with projects for the CSE electives)."""
import unittest
from decimal import Decimal
from coursepath.online_credits import count_online
from coursepath.rules.loader import load_curriculum
from tests.plan_fixtures import attempt, synthetic_attempts

D = Decimal
CURRICULUM = load_curriculum()


def plan(*placeholders, term='2026-27-SUMMER'):
    return {'semesters': [{'term_id': term, 'courses': [], 'placeholders': [
        {'id': f'p{i}', 'requirement_id': requirement, 'desired_credits': credits, 'label': 'Online course', 'online': True} for i, (requirement, credits) in enumerate(placeholders)]}]}


def count(attempts, *placeholders):
    return count_online(CURRICULUM, {'attempts': attempts, 'current_enrolment': []}, plan(*placeholders))


class OnlineCreditsCount(unittest.TestCase):
    def test_a_plan_without_online_courses_counts_nothing_and_says_nothing(self):
        result = count_online(CURRICULUM, {'attempts': synthetic_attempts(), 'current_enrolment': []}, {'semesters': [{'term_id': '2026-27-I', 'courses': [], 'placeholders': []}]})
        self.assertEqual((result['planned'], result['counted'], result['issues']), (0, 0, []))

    def test_online_credits_within_the_limits_all_count(self):
        result = count(synthetic_attempts(), ('open-electives', '8'))
        self.assertEqual((result['planned'], result['counted']), (D(8), D(8)))
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['counted_by_placeholder'], {'p0': D(8)})

    def test_an_online_course_can_count_toward_the_hss_electives(self):
        # D-42 (8 Nov): online credits may go to HSS electives (D-13 had left this open).
        result = count(synthetic_attempts(), ('hss-other', '8'))
        self.assertEqual((result['counted'], result['issues']), (D(8), []))

    def test_no_more_than_16_online_credits_count_and_the_student_is_told(self):
        # HSS electives 8 + open electives 12 = 20 planned; the pool of online credits is 16.
        result = count(synthetic_attempts(), ('hss-other', '8'), ('open-electives', '12'))
        self.assertEqual((result['planned'], result['counted']), (D(20), D(16)))
        self.assertEqual([i['code'] for i in result['issues']], ['ONLINE_CREDIT_LIMIT'])
        self.assertEqual(result['issues'][0]['message'], 'Only 16 of your 20 online credits count toward your degree.')
        self.assertEqual(result['issues'][0]['severity'], 'warning')
        self.assertIn('2026-27-SUMMER', result['issues'][0]['entity_refs'])

    def test_a_pass_fail_conversion_on_the_record_shrinks_the_pool(self):
        # A P on a normally letter-graded course (MA 305, 4 credits) uses 4 credits of the pool: 12 are left (D-11, D-12).
        converted = synthetic_attempts(extra=[attempt('MA 305', '4', '2025-26-II', grade='P')])
        result = count(converted, ('open-electives', '16'))
        self.assertEqual(result['counted'], D(12))
        self.assertEqual([i['code'] for i in result['issues']], ['ONLINE_CREDIT_LIMIT'])

    def test_discipline_electives_take_at_most_8_online_credits_the_rest_count_as_open_electives(self):
        # 10 online credits for the general CSE electives: 8 fit under the cap shared with projects; the other 2 still count, as open electives.
        result = count(synthetic_attempts(), ('cse-general', '10'))
        self.assertEqual((result['counted'], result['issues']), (D(10), []))

    def test_online_courses_already_on_the_record_use_up_the_pool(self):
        record_online = synthetic_attempts(extra=[{**attempt(f'CS 5{i:02d}', '4', '2025-26-II'), 'online': True} for i in range(3)])   # 12 credits already online
        result = count(record_online, ('open-electives', '8'))
        self.assertEqual(result['counted'], D(4))   # 16 - 12

    def test_which_placeholders_fell_short_is_reported(self):
        result = count(synthetic_attempts(), ('hss-other', '8'), ('open-electives', '12'))
        self.assertEqual(sum(result['counted_by_placeholder'].values()), D(16))
        short = [i for i in result['issues'][0]['entity_refs'] if i.startswith('p')]
        self.assertTrue(short)


if __name__ == '__main__':
    unittest.main()
