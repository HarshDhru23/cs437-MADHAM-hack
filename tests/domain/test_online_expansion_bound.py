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


def hss_gap_record():
    """The public ADV13 anchor record minus HS 305 and HS 352: 8 HSS credits remain, and the open electives are full."""
    from tests.domain.test_curriculum_adv13 import PATH, record
    return record([r for r in PATH if r[1] not in {'HS 305', 'HS 352'}])


def one_term(*placeholders):
    return {'semesters': [{'term_id': '2026-27-SUMMER', 'courses': [], 'placeholders': [
        {'id': f'p{i}', 'requirement_id': r, 'desired_credits': c, 'label': 'Online course', 'online': True} for i, (r, c) in enumerate(placeholders)]}]}


class OnlineExpansionKeepsTheAllocatorsAlternatives(unittest.TestCase):
    """CR-103 review [P1]: a bound on the rows built must not drop rows the allocator needs, nor make the count depend on row order."""
    OPEN_FULL_FIRST = (('open-electives', '16'), ('hss-other', '8'))

    def counted(self, *placeholders):
        return count_online(CURRICULUM, hss_gap_record(), one_term(*placeholders))['counted']

    def test_online_rows_for_a_full_requirement_do_not_use_up_the_rows_for_one_that_needs_credits(self):
        # Negative: a global limit built 16 open-elective rows first, so the 8 HSS credits that fill the gap never reached the allocator (counted 0).
        self.assertEqual(self.counted(*self.OPEN_FULL_FIRST), D(8))

    def test_what_counts_does_not_depend_on_the_order_of_the_placeholders(self):
        self.assertEqual(self.counted(*reversed(self.OPEN_FULL_FIRST)), D(8))

    def test_the_bound_never_changes_what_counts_compared_with_no_bound_at_all(self):
        cases = [self.OPEN_FULL_FIRST, tuple(reversed(self.OPEN_FULL_FIRST)),
                 (('cse-general', '20'), ('open-electives', '10')), (('open-electives', '10'), ('cse-general', '20')),
                 (('cse-general', '12'), ('hss-other', '8'), ('open-electives', '12'), ('bs-elective', '4')),
                 (('open-electives', '40'), ('open-electives', '40'), ('hss-other', '100'))]
        for placeholders in cases:
            with self.subTest(placeholders=placeholders):
                bounded = count_online(CURRICULUM, hss_gap_record(), one_term(*placeholders))
                with mock.patch.object(online_credits, 'ONLINE_POOL', D(10 ** 6)):
                    unbounded = count_online(CURRICULUM, hss_gap_record(), one_term(*placeholders))
                self.assertEqual((bounded['counted'], bounded['counted_by_requirement']), (unbounded['counted'], unbounded['counted_by_requirement']))
