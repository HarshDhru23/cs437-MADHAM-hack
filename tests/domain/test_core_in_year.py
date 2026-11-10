"""CP-38 (D-48, D-49): plan generation keeps the CSE core courses in the year they sit in the institute timetables, warns about missing
recommended preparation instead of delaying them, and can start from the completed courses alone or from completed + current courses.

Expected values come from data/curricula/cse-2024-core-years.json (read off the 2024-25 to 2026-27 timetables, not from the generator) and
from the committed 2026-27 snapshots. No private data."""
import json
import unittest
from pathlib import Path
from coursepath.offerings import with_following_terms
from coursepath.plan_generation import generate_plan
from tests.domain.test_plan_generation import CATALOGUE, CURRICULUM, SNAPSHOTS, context, courses
from tests.plan_fixtures import DONE, attempt, synthetic_attempts

CORE_YEARS = json.loads((Path(__file__).resolve().parents[2] / 'data/curricula/cse-2024-core-years.json').read_text(encoding='utf-8'))['courses']
FOLLOWING = with_following_terms(SNAPSHOTS)


def carried(attempts, **extra):
    return {**context(attempts, **extra), 'offering_snapshots': FOLLOWING}


def term_of(result):
    return {p['normalized_code']: p['term_id'] for p in courses(result)}


def first_year_only():
    """A student who finished the first two semesters in 2025-26: the plan starts in 2026-27-I, which is semester 3."""
    shifted = {0: '2025-26-I', 1: '2025-26-II'}
    return [attempt(code, credits, shifted[term], 'P' if code.split()[0] in {'FP', 'GE', 'PE', 'IN'} else 'A') for code, credits, term in DONE if term in shifted]


class CoreInItsYearTests(unittest.TestCase):
    def test_cp38_missing_preparation_warns_and_the_core_course_is_not_delayed(self):
        # ES 242 is pending and is only a recommended preparation for CS 329, CS 330 and CS 331 (team list). Before the fix those three waited a
        # full year (2027-28-I) for ES 242 to be earlier. Now CS 329 and CS 330 sit in the semester the timetable offers them in, year 3, with a
        # warning. CS 331 meets ES 242 at the same hours (a real clash in the 2026-27 timetable), so it is the one course that has to wait for the
        # next semester that offers it; it too is warned about, not blocked.
        result = generate_plan(context(synthetic_attempts(without=('ES 242',))))
        placed = term_of(result)
        self.assertEqual(placed['ES 242'], '2026-27-I')
        for code in ('CS 329', 'CS 330'):
            with self.subTest(code=code):
                self.assertEqual(placed[code], '2026-27-I')
        self.assertIn('CS 331', placed)
        warned = {i['entity_refs'][0]: i for i in result['validation']['issues'] if i['code'] == 'PREREQUISITE_MISSING'}
        for code in ('CS 329', 'CS 330', 'CS 331'):
            if code == 'CS 331' and placed[code] != '2026-27-I':
                continue   # planned after ES 242, so nothing is missing
            item = next(p['item_id'] for p in courses(result) if p['normalized_code'] == code)
            self.assertIn(item, warned)
            self.assertIn('ES 242', warned[item]['message'])    # it says which course is missing
            self.assertEqual(warned[item]['severity'], 'warning')   # D-17: never an error
        placement = next(p for p in courses(result) if p['normalized_code'] == 'CS 330')
        self.assertIn('ES 242', placement['reason'])

    def test_cp38_a_core_course_waits_for_its_own_year_when_the_student_is_ahead(self):
        # Semester 3 starts the plan. Year-2 core (ES 242: sems 3-4) goes in 2026-27; year-3 core (CS 329, HS 151: sems 5-6) in 2027-28.
        result = generate_plan(carried(first_year_only()))
        placed = term_of(result)
        self.assertEqual(CORE_YEARS['ES 242']['year'], 2)
        self.assertEqual(CORE_YEARS['CS 329']['year'], 3)
        self.assertEqual(result['options']['terms'][0], '2026-27-I')
        self.assertEqual(placed['ES 242'], '2026-27-I')
        self.assertIn(placed['CS 329'], {'2027-28-I', '2027-28-II'})
        self.assertIn(placed['CS 330'], {'2027-28-I', '2027-28-II'})

    def test_cp38_core_courses_still_respect_the_credit_limit_and_the_timetable(self):
        result = generate_plan(carried(first_year_only()))
        for credits in result['summary']['credits_by_term'].values():
            self.assertLessEqual(float(credits), 28)
        for p in courses(result):
            self.assertIn(p['basis'], {'confirmed_offering', 'expected_pattern'})

    def test_cp38_a_core_course_offered_only_in_one_parity_goes_in_that_parity(self):
        result = generate_plan(carried(first_year_only()))
        placed = term_of(result)
        self.assertTrue(placed['CS 329'].endswith('-I'))     # offered only in odd semesters (core-years data and the 2026-27 snapshots)
        self.assertTrue(placed['CS 201'].endswith('-II'))    # offered only in even semesters


class CurrentCoursesChoiceTests(unittest.TestCase):
    ENROLLED = [{'id': 'ce-330', 'normalized_code': 'CS 330', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True},
                {'id': 'ce-331', 'normalized_code': 'CS 331', 'term_id': '2026-27-I', 'credits': '4', 'confirmed': True}]

    def test_cp38_completed_and_current_is_the_default_and_starts_after_the_running_semester(self):
        result = generate_plan(context(synthetic_attempts(), current_enrolment=self.ENROLLED))
        self.assertEqual(result['options']['terms'][0], '2026-27-II')
        self.assertNotIn('CS 330', term_of(result))
        self.assertTrue(result['options']['include_current'])

    def test_cp38_completed_only_plans_the_running_semester_again(self):
        result = generate_plan(context(synthetic_attempts(), current_enrolment=self.ENROLLED), {'include_current': False})
        placed = term_of(result)
        self.assertEqual(result['options']['terms'][0], '2026-27-I')
        self.assertEqual(placed.get('CS 330'), '2026-27-I')
        self.assertEqual(placed.get('CS 331'), '2026-27-I')
        self.assertFalse(result['options']['include_current'])

    def test_cp38_include_current_must_be_true_or_false(self):
        for bad in ('yes', 1, None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                generate_plan(context(synthetic_attempts()), {'include_current': bad})


if __name__ == '__main__':
    unittest.main()
