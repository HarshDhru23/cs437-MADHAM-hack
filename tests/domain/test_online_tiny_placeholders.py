"""Issue #157 (CP-21, D-42): when the allocator runs out of its search budget, what counts is not established, so the online count says so
(ALLOCATION_UNRESOLVED) instead of reporting a made-up online credit limit. Thousands of tiny online placeholders (40 terms x 100 of 0.0001 credits,
0.4 credits in all, far under the 16-credit pool) are the case from the review."""
import unittest
from decimal import Decimal
from coursepath.online_credits import count_online
from coursepath.rules.loader import load_curriculum
from tests.plan_fixtures import synthetic_attempts

TERMS = [f'{year}-{str(year + 1)[2:]}-{half}' for year in range(2026, 2046) for half in ('I', 'II')]


def tiny_plan():
    return {'semesters': [{'term_id': term, 'courses': [], 'placeholders': [
        {'id': f'o-{t}-{n}', 'requirement_id': 'open-electives', 'desired_credits': '0.0001', 'online': True} for n in range(100)]}
        for t, term in enumerate(TERMS)]}


class TinyOnlinePlaceholderTests(unittest.TestCase):
    def test_cp21_the_plan_is_the_one_from_the_review(self):
        plan = tiny_plan()
        self.assertEqual(len(plan['semesters']), 40)
        self.assertEqual(sum(Decimal(p['desired_credits']) for s in plan['semesters'] for p in s['placeholders']), Decimal('0.4'))

    def test_cp21_an_exhausted_allocator_gives_allocation_unresolved_not_an_online_limit(self):
        result = count_online(load_curriculum(), {'attempts': synthetic_attempts(), 'current_enrolment': []}, tiny_plan())
        codes = [i['code'] for i in result['issues']]
        self.assertNotIn('ONLINE_CREDIT_LIMIT', codes)
        self.assertIn('ALLOCATION_UNRESOLVED', codes)
        self.assertEqual(result['counted'], Decimal(0))   # nothing is claimed to count while the allocation is not established

    def test_cp21_a_few_online_credits_still_count_as_before(self):
        plan = {'semesters': [{'term_id': '2026-27-I', 'courses': [], 'placeholders': [
            {'id': 'o1', 'requirement_id': 'open-electives', 'desired_credits': '4', 'online': True}]}]}
        result = count_online(load_curriculum(), {'attempts': synthetic_attempts(), 'current_enrolment': []}, plan)
        self.assertEqual((result['counted'], result['issues']), (Decimal(4), []))
