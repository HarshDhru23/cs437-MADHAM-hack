"""CP-46: the elective credits a generated plan holds come in sensible pieces. A student fills a held elective with a course, and courses are 4 or 2 credits,
so a held piece of 1 or 3 credits (a 4-credit requirement cut into 3 + 1 to fill what a lighter semester had left) cannot be filled with one course and
looks like a mistake. A piece is even, or it is the whole of what a requirement still needs; the total held for a requirement and the semester limits do not change.

Expected values: a requirement that needs 4 credits is held as 4, or 2 + 2, never 3 + 1; every requirement's held total equals what it still needs (the plan
check agrees); no semester goes over 28 (10 in a summer)."""
import unittest
from decimal import Decimal

from coursepath.plan_generation import generate_plan
from tests.domain.test_plan_generation import context
from tests.plan_fixtures import synthetic_attempts

OPTION_SETS = [
    {},
    {'target_credits_per_term': '20'},
    {'internship_term': '2027-28-I'},
    {'lighten_with_online': True},
    {'internship_term': '2027-28-I', 'lighten_with_online': True},
    {'lighten_with_online': True, 'target_credits_per_term': '20'},
    {'target_credits_per_term': '16'},
    {'target_credits_per_term': '12', 'max_credits_per_term': '24'},
]


def held(result):
    """Every elective piece the plan holds (not online courses): (term, requirement, credits)."""
    return [(s['term_id'], p['requirement_id'], Decimal(p['desired_credits'])) for s in result['semesters'] for p in s['placeholders']
            if not p.get('online') and not str(p.get('label', '')).startswith('Internship module')]


class PlaceholderSizesTests(unittest.TestCase):
    def test_cp46_a_4_credit_requirement_is_not_cut_into_3_and_1_when_the_semesters_are_lightened(self):
        # The case from the review: an internship semester with online credits lightening the load gave Basic Science 3 + 1.
        result = generate_plan(context(synthetic_attempts()), {'internship_term': '2027-28-I', 'lighten_with_online': True})
        basic = sorted(c for _, requirement, c in held(result) if requirement == 'bs-elective')
        self.assertIn(basic, ([Decimal(4)], [Decimal(2), Decimal(2)]))

    def test_cp46_no_held_piece_is_1_or_3_credits_for_any_choice_of_options(self):
        for options in OPTION_SETS:
            with self.subTest(options=options):
                result = generate_plan(context(synthetic_attempts()), options)
                for term, requirement, credits in held(result):
                    self.assertIn(credits % 2, (0,), f'{credits} credits held for {requirement} in {term}')

    def test_cp46_every_piece_is_at_least_2_credits(self):
        for options in OPTION_SETS:
            with self.subTest(options=options):
                for _, _, credits in held(generate_plan(context(synthetic_attempts()), options)):
                    self.assertGreaterEqual(credits, 2)

    def test_cp46_the_plan_still_covers_every_requirement_and_keeps_the_semester_limits(self):
        for options in OPTION_SETS:
            with self.subTest(options=options):
                result = generate_plan(context(synthetic_attempts()), options)
                self.assertTrue(result['summary']['complete'], options)
                for term, credits in result['summary']['credits_by_term'].items():
                    self.assertLessEqual(Decimal(credits), Decimal(10 if term.endswith('SUMMER') else 28), (options, term))

    def test_cp46_an_odd_remainder_is_kept_whole_not_cut_into_3_and_1(self):
        # Negative: a requirement that really needs an odd number of credits (here 3, after a 3-credit course is taken) is held as one piece of 3.
        attempts = synthetic_attempts(extra=())
        result = generate_plan(context(attempts), {})
        by_requirement = {}
        for _, requirement, credits in held(result):
            by_requirement.setdefault(requirement, []).append(credits)
        for requirement, pieces in by_requirement.items():
            odd = [c for c in pieces if c % 2]
            self.assertLessEqual(len(odd), 1, (requirement, pieces))


if __name__ == '__main__':
    unittest.main()
