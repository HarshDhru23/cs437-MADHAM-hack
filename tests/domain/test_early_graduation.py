"""D-36 to D-40 / CP-35: plans are packed to the 28-credit limit so they end as early as the timetables allow; open-ended electives are held as
credits; an internship semester holds IN 498 modules (4 credits each, 16 at most, split over what is still open) and online courses.
Expected numbers come from the hand count in tests/plan_fixtures.py: 78 credits remain = HSS electives 8 + science basket 8 + BS elective 4 +
CSE core 16 + theory 8 + systems 8 + general CSE electives 10 + open electives 16. The 2026-27 timetables are carried forward to later
years, as the server does."""
import unittest
from decimal import Decimal
from coursepath.offerings import with_following_terms
from coursepath.plan_generation import generate_plan
from tests.domain.test_plan_generation import SNAPSHOTS, context, snapshot_codes
from tests.plan_fixtures import attempt, synthetic_attempts

D = Decimal


def held(result, label_start=None):
    return [(s['term_id'], p) for s in result['semesters'] for p in s['placeholders'] if label_start is None or p['label'].startswith(label_start)]


class PackedPlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshots = with_following_terms(SNAPSHOTS)
        cls.attempts = synthetic_attempts()

    def run_plan(self, attempts, options=None):
        return generate_plan({**context(attempts), 'offering_snapshots': self.snapshots}, options or {})

    def test_cp35_without_an_internship_semesters_are_packed_to_28_and_the_plan_ends_early(self):
        result = self.run_plan(self.attempts)
        credits = [D(c) for c in result['summary']['credits_by_term'].values()]
        self.assertEqual(credits, [D(28), D(28), D(22)])   # 78 = 28 + 28 + 22: three semesters, not the usual four
        self.assertEqual(result['summary']['terms'], ['2026-27-I', '2026-27-II', '2027-28-I'])
        self.assertTrue(result['graduation']['early'])
        self.assertEqual((result['graduation']['last_term'], result['graduation']['usual_last_term']), ('2027-28-I', '2027-28-II'))
        self.assertIn('1 semester before the usual 2027–28 Semester II', result['graduation']['message'])   # the wording the student sees
        self.assertEqual(result['graduation']['online_credits'], '0')   # 78 credits need a third semester however many online credits are used
        self.assertTrue(result['summary']['complete'])

    def test_cp35_no_semester_is_ever_above_28(self):
        for options in ({}, {'internship_term': '2027-28-I'}, {'internship_term': '2026-27-II'}, {'target_credits_per_term': '20'}):
            with self.subTest(options=options):
                for term, credits in self.run_plan(self.attempts, options)['summary']['credits_by_term'].items():
                    self.assertLessEqual(D(credits), 28, term)

    def test_cp35_a_lower_target_spreads_the_work_and_ends_later(self):
        result = self.run_plan(self.attempts, {'target_credits_per_term': '20'})
        self.assertEqual(result['options']['target_credits_per_term'], '20')
        self.assertEqual([D(c) for c in result['summary']['credits_by_term'].values()], [D(20), D(20), D(20), D(18)])
        self.assertFalse(result['graduation']['early'])

    def test_cp35_open_ended_electives_are_held_as_labelled_credits_that_add_up_to_what_remains(self):
        result = self.run_plan(self.attempts)
        by_requirement = {}
        for _, p in held(result):
            by_requirement[p['requirement_id']] = by_requirement.get(p['requirement_id'], D(0)) + D(p['desired_credits'])
        self.assertEqual(by_requirement, {'hss-other': D(8), 'bs-elective': D(4), 'cse-general': D(10), 'open-electives': D(16)})
        self.assertEqual({p['label'] for _, p in held(result)}, {'HSS elective', 'Basic Science elective', 'CSE elective', 'Open elective'})
        # everything else is a real course from the timetable: 16 core + 8 theory + 8 systems + 8 science = 40 credits
        self.assertEqual(result['summary']['placed_credits'], '40')

    def test_cp35_an_internship_in_2027_28_I_ends_the_plan_with_that_semester(self):
        result = self.run_plan(self.attempts, {'internship_term': '2027-28-I'})
        self.assertEqual(result['summary']['terms'][-1], '2027-28-I')
        self.assertTrue(result['graduation']['early'])
        internship = next(s for s in result['semesters'] if s['term_id'] == '2027-28-I')
        self.assertEqual(internship['courses'], [])   # no timetabled course in the internship semester
        self.assertTrue(result['summary']['complete'])

    def test_cp35_the_16_internship_credits_go_to_the_narrowest_requirements_that_still_need_them(self):
        # Open project is done, HSS electives need 8 and open electives 16: two HSS modules, then open-elective modules, four modules in all.
        result = self.run_plan(self.attempts, {'internship_term': '2027-28-I'})
        modules = [p for _, p in held(result, 'Internship module')]
        self.assertEqual([(p['requirement_id'], p['desired_credits']) for p in modules],
                         [('hss-other', '4'), ('hss-other', '4'), ('open-electives', '4'), ('open-electives', '4')])

    def test_cp35_a_missing_open_project_takes_a_module_first(self):
        result = self.run_plan(synthetic_attempts(without=('CS 299',)), {'internship_term': '2027-28-I'})
        modules = [p['requirement_id'] for _, p in held(result, 'Internship module')]
        self.assertEqual(modules, ['open-project', 'hss-other', 'hss-other', 'open-electives'])   # project 4, HSS 8, open electives 4: 16 in all

    def test_cp35_internship_modules_never_exceed_16_credits_or_what_is_still_open(self):
        for attempts in (self.attempts, synthetic_attempts(without=('CS 299',)), synthetic_attempts(without=('ES 214', 'ES 204', 'ES 336', 'CS 202'))):
            result = self.run_plan(attempts, {'internship_term': '2027-28-I'})
            modules = [p for _, p in held(result, 'Internship module')]
            self.assertLessEqual(sum(D(p['desired_credits']) for p in modules), 16)
            self.assertTrue(all(D(p['desired_credits']) == 4 for p in modules))
            hss = sum(D(p['desired_credits']) for p in modules if p['requirement_id'] == 'hss-other')
            self.assertLessEqual(hss, 8)   # at most 8 internship credits count toward HSS electives (ADV13 p. 3)

    # Four more 4-credit HS courses already done: 8 credits fill the HSS electives and 8 the open electives, so 78 - 16 = 62 credits remain.
    EXTRA = [attempt(f'HS 3{i:02d}', '4', '2025-26-II') for i in range(4)]

    def test_cp35_online_credits_in_the_summer_break_save_a_semester(self):
        # 78 - 16 = 62 = 28 + 28 + 6: without online credits a third semester is needed; with 6 online credits taken in the summer break
        # after the second semester the plan ends there, two semesters before the usual end (D-41).
        result = self.run_plan(synthetic_attempts(extra=self.EXTRA))
        self.assertEqual(result['summary']['remaining_before'], '62')
        self.assertEqual(result['summary']['terms'], ['2026-27-I', '2026-27-II', '2026-27-SUMMER'])
        self.assertEqual(result['graduation']['last_term'], '2026-27-SUMMER')
        self.assertEqual(result['graduation']['online_credits'], '6')   # only as many as the saved semester needs, not the whole pool
        self.assertIn('2 semesters before the usual 2027–28 Semester II', result['graduation']['message'])
        self.assertIn('6 credits of online courses', result['graduation']['message'])
        self.assertTrue(result['summary']['complete'])

    def test_cp35_online_courses_follow_the_rules_for_online_credit(self):
        result = self.run_plan(synthetic_attempts(extra=self.EXTRA))
        online = held(result, 'Online course')
        self.assertTrue(online)
        self.assertEqual({term for term, _ in online}, {'2026-27-SUMMER'})   # breaks only, never a regular semester
        self.assertTrue({p['requirement_id'] for _, p in online} <= {'cse-general', 'open-electives'})   # never HSS or Basic Science
        self.assertLessEqual(sum(D(p['desired_credits']) for _, p in online), 16)   # the pool of online credits
        for term, credits in result['summary']['credits_by_term'].items():
            self.assertLessEqual(D(credits), 10 if term.endswith('SUMMER') else 28, term)   # a summer holds at most 10 credits (ADV13 p. 7)

    def test_cp35_online_credits_are_not_used_when_they_would_not_save_a_semester(self):
        result = self.run_plan(self.attempts)   # 78 credits: three semesters either way
        self.assertEqual(held(result, 'Online course'), [])
        self.assertEqual(result['graduation']['online_credits'], '0')

    def test_cp35_the_online_pool_is_never_exceeded_even_for_a_long_plan(self):
        result = self.run_plan(synthetic_attempts(without=('ES 214', 'ES 204', 'ES 336', 'CS 202', 'HS 201', 'HS 221')))
        online = sum(D(p['desired_credits']) for _, p in held(result, 'Online course'))
        self.assertLessEqual(online, 16)
        for term, credits in result['summary']['credits_by_term'].items():
            self.assertLessEqual(D(credits), 10 if term.endswith('SUMMER') else 28, term)

    def test_cp35_the_options_still_list_only_regular_semesters(self):
        result = self.run_plan(synthetic_attempts(extra=self.EXTRA))
        self.assertTrue(all(not t.endswith('SUMMER') for t in result['options']['terms']))

    def test_cp35_an_internship_in_the_last_term_does_not_end_the_plan_early(self):
        result = self.run_plan(self.attempts, {'internship_term': '2027-28-II'})
        self.assertEqual(result['summary']['terms'][-1], '2027-28-II')
        self.assertFalse(result['graduation']['early'])
        self.assertIsNone(result['graduation']['message'])

    def test_cp35_too_few_semesters_leave_the_rest_uncovered_and_say_so(self):
        result = self.run_plan(self.attempts, {'terms': ['2026-27-I', '2026-27-II']})   # room for 56 of the 78 credits
        self.assertFalse(result['summary']['complete'])
        self.assertIn('NO_CAPACITY', {u['reason_code'] for u in result['unmet']})
        self.assertIsNone(result['graduation']['early'])
        for credits in result['summary']['credits_by_term'].values():
            self.assertLessEqual(D(credits), 28)

    def test_cp35_an_internship_term_outside_the_plan_is_rejected(self):
        with self.assertRaises(ValueError):
            self.run_plan(self.attempts, {'internship_term': '2035-36-I'})

    def test_cp35_later_terms_follow_the_semester_timetable_with_no_unconfirmed_course(self):
        result = self.run_plan(self.attempts, {'target_credits_per_term': '20'})
        self.assertEqual({p['basis'] for p in result['placements'] if p['kind'] == 'course'}, {'confirmed_offering'})
        odd = {p['normalized_code'] for p in result['placements'] if p['term_id'] == '2027-28-I' and p['kind'] == 'course'}
        even = {p['normalized_code'] for p in result['placements'] if p['term_id'] == '2027-28-II' and p['kind'] == 'course'}
        self.assertTrue(odd <= snapshot_codes('2026-27-I'))    # odd semesters follow the 2026-27 Semester I timetable
        self.assertTrue(even <= snapshot_codes('2026-27-II'))  # even semesters follow the Semester II timetable

    def test_cp35_the_plan_never_places_credits_in_a_semester_beyond_the_requirement_it_names(self):
        result = self.run_plan(self.attempts, {'internship_term': '2027-28-I'})
        total = sum(D(p['desired_credits']) for _, p in held(result)) + D(result['summary']['placed_credits'])
        self.assertEqual(total, D(result['summary']['remaining_before']))   # 78: nothing double counted, nothing missing


class LightenWithOnlineTests(unittest.TestCase):
    """D-42: the student can see what online credits taken in the breaks could do for the semester workload: the same last semester, the online
    credits used in the summer break, and the rest of the work spread evenly. Hand counts: 78 credits remain (tests/plan_fixtures.py)."""

    @classmethod
    def setUpClass(cls):
        cls.snapshots = with_following_terms(SNAPSHOTS)
        cls.attempts = synthetic_attempts()

    def run_plan(self, options=None, attempts=None):
        return generate_plan({**context(attempts or self.attempts), 'offering_snapshots': self.snapshots}, options or {})

    def test_cp35_without_the_option_the_plan_reports_what_online_credits_could_do(self):
        result = self.run_plan()
        potential = result['online_potential']
        self.assertEqual((potential['lightened'], potential['busiest_before']), (False, None))
        self.assertEqual(potential['busiest_semester_credits'], '28')   # 28 + 28 + 22
        self.assertEqual(potential['credits_available'], '16')           # the whole pool is unused
        self.assertEqual(potential['break_terms'], ['2026-27-SUMMER'])  # the only break before the last semester, 2027-28 Semester I

    def test_cp35_lightening_keeps_the_last_semester_and_lowers_the_busiest_one(self):
        base, lighter = self.run_plan(), self.run_plan({'lighten_with_online': True})
        self.assertEqual(lighter['graduation']['last_term'], base['graduation']['last_term'])
        self.assertTrue(lighter['online_potential']['lightened'])
        self.assertEqual(lighter['online_potential']['busiest_before'], '28')
        # 10 credits go online in the summer break (its limit), the other 68 are spread over three semesters. Held elective credits come in even pieces
        # (CP-46), so the spread is 24 + 22 + 22 (it was 23 + 23 + 22 when a 3-credit piece was allowed)
        self.assertEqual(lighter['graduation']['online_credits'], '10')
        self.assertEqual(lighter['online_potential']['busiest_semester_credits'], '24')
        self.assertEqual(lighter['summary']['credits_by_term'], {'2026-27-I': '24', '2026-27-II': '22', '2026-27-SUMMER': '10', '2027-28-I': '22'})
        self.assertTrue(lighter['summary']['complete'])
        self.assertEqual(lighter['options']['lighten_with_online'], True)

    def test_cp35_a_lightened_plan_still_covers_every_credit_once(self):
        lighter = self.run_plan({'lighten_with_online': True})
        self.assertEqual(sum(D(c) for c in lighter['summary']['credits_by_term'].values()), 78)
        for term, credits in lighter['summary']['credits_by_term'].items():
            self.assertLessEqual(D(credits), 10 if term.endswith('SUMMER') else 28, term)

    def test_cp35_online_courses_are_marked_online_and_only_in_the_breaks(self):
        lighter = self.run_plan({'lighten_with_online': True})
        online = [(s['term_id'], p) for s in lighter['semesters'] for p in s['placeholders'] if p.get('online')]
        self.assertTrue(online)
        self.assertEqual({term for term, _ in online}, {'2026-27-SUMMER'})
        self.assertTrue(all(p['label'] == 'Online course' for _, p in online))
        self.assertEqual([p for s in lighter['semesters'] for p in s['placeholders'] if p['label'] == 'Online course' and not p.get('online')], [])

    def test_cp35_with_an_internship_the_online_credits_still_lighten_the_semesters(self):
        base, lighter = self.run_plan({'internship_term': '2027-28-I'}), self.run_plan({'internship_term': '2027-28-I', 'lighten_with_online': True})
        self.assertEqual(base['online_potential']['busiest_semester_credits'], '28')
        self.assertEqual(lighter['online_potential']['busiest_before'], '28')
        self.assertLess(D(lighter['online_potential']['busiest_semester_credits']), 28)
        self.assertEqual(lighter['graduation']['last_term'], '2027-28-I')   # still ends with the internship semester
        internship = next(s for s in lighter['semesters'] if s['term_id'] == '2027-28-I')
        self.assertEqual(internship['courses'], [])
        # D-50 (10 Nov): online credits are outside a regular semester's load, so the internship semester's credits are its modules alone.
        self.assertEqual(sum(D(p['desired_credits']) for p in internship['placeholders'] if not p.get('online')), D(lighter['summary']['credits_by_term']['2027-28-I']))
        self.assertLessEqual(D(lighter['summary']['credits_by_term']['2027-28-I']), 28)
        online = sum(D(p['desired_credits']) for s in lighter['semesters'] for p in s['placeholders'] if p.get('online'))
        self.assertEqual(online, D(lighter['graduation']['online_credits']))
        self.assertLessEqual(online, 16)   # the pool

    def test_cp35_a_plan_that_could_not_cover_everything_is_returned_as_it_is(self):
        result = self.run_plan({'lighten_with_online': True, 'terms': ['2026-27-I', '2026-27-II']})
        self.assertFalse(result['summary']['complete'])
        self.assertFalse(result['online_potential']['lightened'])
        self.assertIsNone(result['online_potential']['busiest_before'])

    def test_cp35_the_option_must_be_true_or_false(self):
        with self.assertRaises(ValueError):
            self.run_plan({'lighten_with_online': 'yes'})

    def test_cp35_online_credits_used_by_the_plan_are_not_offered_again(self):
        result = self.run_plan(options={}, attempts=synthetic_attempts(extra=PackedPlanTests.EXTRA))   # ends in the summer with 6 online credits
        self.assertEqual(result['graduation']['online_credits'], '6')
        self.assertEqual(result['online_potential']['credits_available'], '10')   # 16 - 6


if __name__ == '__main__':
    unittest.main()
