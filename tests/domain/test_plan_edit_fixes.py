"""CP-39 (D-50, D-51): online courses are held outside a regular semester's load, and a course moved to another term does not carry the old
term's offering or section choice, which made the new term report an error although the course is offered there.

Expected values are counted by hand: seven 4-credit courses are 28 credits, the regular-semester limit (D-36); the summer limit is 10."""
import unittest
from coursepath.data_sources.official_timetables import load_committed_snapshots
from coursepath.offerings import with_following_terms
from coursepath.semester_plan import validate_plan
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOTS = with_following_terms(load_committed_snapshots(ROOT / 'data' / 'offerings'))
D = __import__('decimal').Decimal


def course(n, code=None, credits='4', **extra):
    return {'id': f'c{n}', 'normalized_code': code or f'ZZ {100 + n}', 'credits': credits, **extra}


def online(n, credits, term_id):
    return {'id': f'o{n}-{term_id}', 'requirement_id': 'open-electives', 'desired_credits': credits, 'label': 'Online course', 'online': True}


def check(semesters, snapshots=None):
    return validate_plan({'attempts': [], 'catalogue': {}, 'simple_load': True}, {'semesters': semesters}, snapshots)


def codes(result):
    return [i['code'] for i in result['issues']]


class OnlineOutsideTheLoadTests(unittest.TestCase):
    FULL = [course(n) for n in range(7)]   # 28 credits

    def test_cp39_an_online_course_does_not_raise_a_regular_semesters_load(self):
        result = check([{'term_id': '2027-28-I', 'courses': self.FULL, 'placeholders': [online(1, '4', '2027-28-I')]}])
        row = result['workload']['2027-28-I']
        self.assertEqual((row['selected_credits'], row['target_credits'], row['online_credits']), ('28', '28', '4'))
        self.assertNotIn('LOAD_LIMIT', codes(result))

    def test_cp39_a_placeholder_that_is_not_online_still_counts(self):
        held = [{'id': 'p1', 'requirement_id': 'open-electives', 'desired_credits': '4', 'label': 'Open elective'}]
        result = check([{'term_id': '2027-28-I', 'courses': self.FULL, 'placeholders': held}])
        self.assertEqual(result['workload']['2027-28-I']['target_credits'], '32')
        self.assertNotIn('online_credits', result['workload']['2027-28-I'])   # present only where online credits are held
        self.assertIn('LOAD_LIMIT', codes(result))

    def test_cp39_a_summer_break_holds_only_online_credits_so_they_do_count_toward_its_limit(self):
        result = check([{'term_id': '2027-28-SUMMER', 'courses': [], 'placeholders': [online(1, '8', 's'), online(2, '4', 's')]}])
        self.assertEqual(result['workload']['2027-28-SUMMER']['target_credits'], '12')
        self.assertIn('LOAD_LIMIT', codes(result))   # 12 > 10
        ok = check([{'term_id': '2027-28-SUMMER', 'courses': [], 'placeholders': [online(1, '8', 's')]}])
        self.assertEqual(ok['workload']['2027-28-SUMMER']['target_credits'], '8')
        self.assertNotIn('LOAD_LIMIT', codes(ok))

    def test_cp39_online_courses_are_still_a_placeholder_to_resolve(self):
        result = check([{'term_id': '2027-28-I', 'courses': [], 'placeholders': [online(1, '4', '2027-28-I')]}])
        self.assertIn('PLACEHOLDER_UNRESOLVED', codes(result))


class MovedCourseTests(unittest.TestCase):
    """CS 330 is offered in 2026-27-I and, following the odd-semester timetable (D-38), in 2027-28-I."""

    def old_choice(self):
        offering = next(o for s in SNAPSHOTS if s['term_id'] == '2026-27-I' for o in s['offerings'] if o['code'] == 'CS 330')
        sections = [m['id'] for g in offering['meeting_groups'] for m in g['meetings']][:1]
        return {'offering_id': offering['id'], 'section_ids': sections}

    def moved(self, **extra):
        item = course(1, 'CS 330', **self.old_choice(), **extra)
        return check([{'term_id': '2027-28-I', 'courses': [item], 'placeholders': []}], SNAPSHOTS)

    def test_cp39_a_course_moved_with_the_old_terms_offering_and_sections_is_not_reported_as_unknown(self):
        result = self.moved()
        self.assertNotIn('OFFERING_VARIANT_UNKNOWN', codes(result))
        self.assertNotIn('SECTION_UNKNOWN', codes(result))
        self.assertEqual([i for i in result['issues'] if i['severity'] == 'error'], [])

    def test_cp39_a_variant_that_belongs_to_this_term_but_does_not_exist_is_still_an_error(self):
        item = course(1, 'CS 330', offering_id='2027-28-I:NOSUCHCOURSE')
        result = check([{'term_id': '2027-28-I', 'courses': [item], 'placeholders': []}], SNAPSHOTS)
        self.assertIn('OFFERING_VARIANT_UNKNOWN', codes(result))


if __name__ == '__main__':
    unittest.main()


class GeneratedPlanLoadAgreesWithTheCheckTests(unittest.TestCase):
    """The semester totals a generated plan states are the ones the plan check reports, whatever online courses it holds and wherever."""

    def test_cp39_generated_credits_by_term_match_the_checked_workload_with_online_courses_and_an_internship(self):
        from coursepath.plan_generation import generate_plan
        from tests.domain.test_plan_generation import context
        from tests.plan_fixtures import synthetic_attempts
        for options in ({}, {'internship_term': '2027-28-I'}, {'lighten_with_online': True}, {'internship_term': '2027-28-I', 'lighten_with_online': True}):
            with self.subTest(options=options):
                result = generate_plan(context(synthetic_attempts()), options)
                for term, credits in result['summary']['credits_by_term'].items():
                    self.assertEqual(D(credits), D(result['validation']['workload'][term]['target_credits']), term)
                for term, row in result['validation']['workload'].items():
                    if not term.endswith('SUMMER'):
                        self.assertLessEqual(D(row['target_credits']), 28)
