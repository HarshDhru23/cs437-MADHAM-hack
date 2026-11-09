"""CR-103 (CP-18, CP-35, CP-36): online placeholders are turned into allocator rows only up to the 16-credit pool (D-11, D-41, D-42), however many
credits they ask for. Nothing beyond 16 can ever count, so expanding it only costs time."""
import unittest
from decimal import Decimal
from unittest import mock
from coursepath import online_credits
from coursepath.online_credits import count_online
from coursepath.rules.loader import load_curriculum
from tests.plan_fixtures import synthetic_attempts

D = Decimal
CURRICULUM = load_curriculum()
RECORD = {'attempts': synthetic_attempts(), 'current_enrolment': []}


def plan(*credits):
    return {'semesters': [{'term_id': '2026-27-SUMMER', 'courses': [], 'placeholders': [
        {'id': f'p{i}', 'requirement_id': 'open-electives', 'desired_credits': c, 'label': 'Online course', 'online': True} for i, c in enumerate(credits)]}]}


def rows_given_to_the_allocator(*credits):
    """(result, how many online rows count_online handed to evaluate_audit, their credits)."""
    seen = []
    real = online_credits.evaluate_audit

    def spy(curriculum, grades, record, plan_):
        seen.append([c for s in plan_['semesters'] for c in s['courses'] if c.get('online')])
        return real(curriculum, grades, record, plan_)

    with mock.patch.object(online_credits, 'evaluate_audit', spy):
        result = count_online(CURRICULUM, RECORD, plan(*credits))
    rows = seen[0]
    return result, len(rows), sum(D(r['credits']) for r in rows)


class OnlineExpansionBound(unittest.TestCase):
    def test_a_huge_online_placeholder_is_not_expanded_past_the_pool(self):
        result, rows, credits = rows_given_to_the_allocator('10000', '10000')
        self.assertLessEqual(credits, 16, f'{rows} rows holding {credits} credits were built for the allocator')
        self.assertEqual((result['planned'], result['counted']), (D(20000), D(16)))
        self.assertEqual([i['code'] for i in result['issues']], ['ONLINE_CREDIT_LIMIT'])
        self.assertEqual(result['issues'][0]['message'], 'Only 16 of your 20000 online credits count toward your degree.')

    def test_exactly_the_pool_still_counts_in_full_and_says_nothing(self):
        # Negative: a bound below 16 would silently drop credits that do count.
        result, rows, credits = rows_given_to_the_allocator('8', '8')
        self.assertEqual((credits, result['counted'], result['issues']), (D(16), D(16), []))

    def test_a_placeholder_past_the_bound_is_named_in_the_warning(self):
        result, _rows, _credits = rows_given_to_the_allocator('16', '4')
        self.assertEqual((result['counted'], result['counted_by_placeholder']), (D(16), {'p0': D(16)}))
        self.assertEqual(result['issues'][0]['entity_refs'], ['2026-27-SUMMER', 'p1'])
