"""H12 internship dates, availability and IN 498 modules (CP-33, CP-34).

Rules come from contracts section 6 and docs/academic-decisions.md D-14:
4-credit modules, at most 16 credits, open electives / HSS (max 8) / open
project (max 4) only, no per-quad limit, and duration never grants credit.
The calendar below is synthetic; no 2026-28 calendar is committed (GAP-03).
"""
from copy import deepcopy
from datetime import date
import unittest
from coursepath.calendar import add_calendar_months, from_inclusive, to_inclusive, preset_dates
from coursepath.internships import evaluate_internship, compare_internships, propose_split

CALENDAR = {'id': 'synthetic-calendar', 'review_status': 'reviewed', 'terms': [
    {'id': '2026-27-II', 'start_date': '2027-01-01', 'end_date_exclusive': '2027-05-01', 'exams': [{'start_date': '2027-04-20', 'end_date_exclusive': '2027-05-01'}]},
    {'id': '2026-27-SUMMER', 'start_date': '2027-05-10', 'end_date_exclusive': '2027-07-10', 'exams': []},
    {'id': '2027-28-I', 'start_date': '2027-08-01', 'end_date_exclusive': '2027-12-01', 'exams': [{'start_date': '2027-11-20', 'end_date_exclusive': '2027-12-01'}]},
    {'id': '2027-28-II', 'start_date': '2028-01-01', 'end_date_exclusive': '2028-05-01', 'exams': []}]}
CATALOGUE = {'ZZ 400': {'prerequisite_known': True, 'prerequisites': {'type': 'course', 'course_id': 'ZZ 300'}}}
PLAN = {'id': 'plan', 'revision': 3, 'semesters': [
    {'term_id': '2026-27-SUMMER', 'courses': [{'id': 's1', 'normalized_code': 'ZZ 150', 'credits': '4'}]},
    {'term_id': '2027-28-I', 'courses': [{'id': 'f1', 'normalized_code': 'ZZ 300', 'credits': '4'}]},
    {'term_id': '2027-28-II', 'courses': [{'id': 'w1', 'normalized_code': 'ZZ 400', 'credits': '4'}]}]}
CONTEXT = {'attempts': [], 'catalogue': CATALOGUE, 'approvals': [], 'record_revision': 7}


def internship(choice, start=None, end=None, mode='onsite_full_time', modules=()):
    return {'id': 'i-' + choice, 'duration_choice': choice, 'preset': 'custom', 'start_date': start, 'end_date_exclusive': end,
            'placement_mode': mode, 'modules': list(modules)}


def module(module_id, target, status='proposed', credits='4', **extra):
    return {'id': module_id, 'credits': credits, 'intended_allocation': target, 'status': status, **extra}


def codes(result):
    return [i['code'] for i in result['issues']]


class CalendarArithmeticTests(unittest.TestCase):
    def test_cp33_calendar_months_clamp_month_end_and_leap_day(self):
        self.assertEqual(add_calendar_months(date(2027, 5, 1), 3), date(2027, 8, 1))
        self.assertEqual(add_calendar_months(date(2027, 1, 31), 1), date(2027, 2, 28))
        self.assertEqual(add_calendar_months(date(2028, 1, 31), 1), date(2028, 2, 29))
        self.assertEqual(add_calendar_months(date(2027, 8, 31), 6), date(2028, 2, 29))
        self.assertEqual(add_calendar_months(date(2027, 11, 30), 3), date(2028, 2, 29))
        # Inclusive last day in the UI becomes an exclusive engine bound exactly once.
        self.assertEqual(from_inclusive('2027-05-01', '2027-07-31'), (date(2027, 5, 1), date(2027, 8, 1)))
        self.assertEqual(to_inclusive(date(2027, 8, 1)), date(2027, 7, 31))
        self.assertEqual(from_inclusive('2028-02-01', '2028-02-29')[1], date(2028, 3, 1))

    def test_cp33_presets_need_the_calendar_and_never_invent_a_summer(self):
        self.assertEqual(preset_dates('three_months', 'summer', CALENDAR, '2026-27-SUMMER'), (date(2027, 5, 10), date(2027, 8, 10)))
        self.assertEqual(preset_dates('six_months', 'semester', CALENDAR, '2027-28-I'), (date(2027, 8, 1), date(2028, 2, 1)))
        for calendar, term in [(None, '2026-27-SUMMER'), (CALENDAR, '2028-29-SUMMER'), ({'terms': [{'id': '2026-27-SUMMER', 'start_date': None, 'end_date_exclusive': None}]}, '2026-27-SUMMER')]:
            with self.assertRaisesRegex(ValueError, 'CALENDAR_MISSING'):
                preset_dates('three_months', 'summer', calendar, term)
        with self.assertRaises(ValueError):
            preset_dates('none', 'summer', CALENDAR, '2026-27-SUMMER')


class InternshipAvailabilityTests(unittest.TestCase):
    def test_cp33_none_leaves_baseline_unchanged_and_rejects_stale_modules(self):
        context, plan = deepcopy(CONTEXT), deepcopy(PLAN)
        result = evaluate_internship(context, internship('none'), plan, CALENDAR)
        self.assertEqual((context, plan), (CONTEXT, PLAN))
        self.assertEqual((result['start_date'], result['affected_courses'], result['overlapping_terms']), (None, [], []))
        self.assertEqual(result['credits']['proposed'], '0')
        stale = evaluate_internship(context, internship('none', modules=[module('m1', 'open_elective')]), plan, CALENDAR)
        self.assertIn('INTERNSHIP_STALE_MODULES', codes(stale))
        self.assertEqual(stale['credits']['proposed'], '0')

    def test_cp33_summer_three_months_blocks_only_overlapping_dates(self):
        result = evaluate_internship(CONTEXT, internship('three_months', '2027-05-01', '2027-08-01'), PLAN, CALENDAR)
        self.assertEqual(result['actual_days'], 92)
        self.assertEqual([t['term_id'] for t in result['overlapping_terms']], ['2026-27-SUMMER'])  # II ends and I starts on touching days
        self.assertEqual(result['affected_courses'], ['s1'])
        self.assertIn('INTERNSHIP_ATTENDANCE_CONFLICT', codes(result))
        self.assertNotIn('f1', result['affected_courses'])
        self.assertNotIn('INTERNSHIP_DURATION_DIFFERS', codes(result))

    def test_cp33_six_months_spanning_semester_reveals_exams_and_downstream(self):
        result = evaluate_internship(CONTEXT, internship('six_months', '2027-07-01', '2028-01-01'), PLAN, CALENDAR)
        terms = {t['term_id']: t for t in result['overlapping_terms']}
        self.assertEqual(sorted(terms), ['2026-27-SUMMER', '2027-28-I'])
        self.assertEqual((terms['2026-27-SUMMER']['overlap_days'], terms['2027-28-I']['overlap_days']), (9, 122))
        self.assertTrue(terms['2027-28-I']['exam_overlap'])
        self.assertEqual(sorted(result['affected_courses']), ['f1', 's1'])
        self.assertEqual(result['downstream_courses'], ['w1'])
        self.assertEqual(PLAN['semesters'][1]['courses'][0]['id'], 'f1')  # reported, never auto-dropped

    def test_cp33_partial_term_overlap_and_remote_mode_still_need_permission(self):
        partial = evaluate_internship(CONTEXT, internship('three_months', '2027-10-01', '2028-01-01'), PLAN, CALENDAR)
        self.assertEqual([(t['term_id'], t['overlap_days'], t['exam_overlap']) for t in partial['overlapping_terms']], [('2027-28-I', 61, True)])
        remote = evaluate_internship(CONTEXT, internship('three_months', '2027-10-01', '2028-01-01', mode='remote_or_part_time'), PLAN, CALENDAR)
        severities = {i['severity'] for i in remote['issues'] if i['code'] == 'INTERNSHIP_ATTENDANCE_CONFLICT'}
        self.assertEqual(severities, {'approval_required'})
        self.assertEqual(remote['affected_courses'], ['f1'])

    def test_cp33_invalid_dates_changed_length_and_missing_calendar(self):
        for start, end in [('2027-05-01', '2027-05-01'), ('2027-08-01', '2027-05-01'), (None, '2027-08-01'), ('2027-02-30', '2027-05-01')]:
            result = evaluate_internship(CONTEXT, internship('three_months', start, end), PLAN, CALENDAR)
            self.assertIn('INTERNSHIP_DATES_INVALID', codes(result))
            self.assertEqual(result['affected_courses'], [])
        longer = evaluate_internship(CONTEXT, internship('three_months', '2027-05-01', '2027-09-01'), PLAN, CALENDAR)
        self.assertIn('INTERNSHIP_DURATION_DIFFERS', codes(longer))
        self.assertEqual(longer['expected_end_date_exclusive'], '2027-08-01')
        blind = evaluate_internship(CONTEXT, internship('three_months', '2027-05-01', '2027-08-01'), PLAN, None)
        self.assertIn('CALENDAR_MISSING', codes(blind))
        self.assertEqual(blind['overlapping_terms'], [])
        self.assertEqual(sorted(blind['unchecked_courses']), ['f1', 's1', 'w1'])  # unknown, not cleared

    def test_cp33_compare_none_three_six_on_one_unchanged_baseline(self):
        context, plan = deepcopy(CONTEXT), deepcopy(PLAN)
        cases = [internship('none'), internship('three_months', '2027-05-01', '2027-08-01'), internship('six_months', '2027-07-01', '2028-01-01')]
        result = compare_internships(context, plan, CALENDAR, cases)
        self.assertEqual((context, plan), (CONTEXT, PLAN))
        self.assertEqual((result['baseline_record_revision'], result['baseline_plan_revision']), (7, 3))
        self.assertEqual([c['duration_choice'] for c in result['cases']], ['none', 'three_months', 'six_months'])
        self.assertEqual([len(c['affected_courses']) for c in result['cases']], [0, 1, 2])
        self.assertEqual([c['approved_credits'] for c in result['cases']], ['0', '0', '0'])
        self.assertTrue(all(c['completion_assumptions'] for c in result['cases'][1:]))


class InternshipModuleTests(unittest.TestCase):
    def evaluate(self, modules, approvals=(), attempts=(), remaining=None):
        context = {**CONTEXT, 'approvals': list(approvals), 'attempts': list(attempts)}
        if remaining is not None:
            context['remaining'] = remaining
        return evaluate_internship(context, internship('six_months', '2027-07-01', '2028-01-01', modules=modules), PLAN, CALENDAR)

    def test_cp34_duration_alone_grants_no_credit(self):
        for choice, start, end in [('three_months', '2027-05-01', '2027-08-01'), ('six_months', '2027-07-01', '2028-01-01')]:
            credits = evaluate_internship(CONTEXT, internship(choice, start, end), PLAN, CALENDAR)['credits']
            self.assertEqual((credits['earned'], credits['approved'], credits['proposed']), ('0', '0', '0'))

    def test_cp34_example_twelve_open_four_hss_stays_proposed(self):
        modules = [module('m1', 'open_elective'), module('m2', 'open_elective'), module('m3', 'open_elective'), module('m4', 'hss')]
        result = self.evaluate(modules)
        self.assertEqual(result['credits']['proposed'], '16')
        self.assertEqual(result['credits']['proposed_by_target'], {'open_elective': '12', 'hss': '4'})
        self.assertEqual((result['credits']['approved'], result['credits']['earned']), ('0', '0'))
        self.assertIn('INTERNSHIP_APPROVAL_REQUIRED', codes(result))

    def test_cp34_only_verified_covering_approval_counts(self):
        claimed = self.evaluate([module('m1', 'open_elective', approval_status='verified')])
        self.assertEqual((claimed['credits']['approved'], claimed['credits']['proposed']), ('0', '4'))
        foreign = self.evaluate([module('m1', 'open_elective', approval_ref='a1')], [{'id': 'a1', 'status': 'verified', 'covered_entities': ['someone-else']}])
        self.assertEqual(foreign['credits']['approved'], '0')
        reported = self.evaluate([module('m1', 'open_elective', approval_ref='a1')], [{'id': 'a1', 'status': 'user_reported', 'covered_entities': ['m1']}])
        self.assertEqual(reported['credits']['approved'], '0')
        verified = [{'id': 'a1', 'status': 'verified', 'covered_entities': ['m1', 'm2']}]
        result = self.evaluate([module('m1', 'open_elective', approval_ref='a1'), module('m2', 'hss', 'completed', approval_ref='a1', grade='P'),
                                module('m3', 'hss', 'completed', approval_ref='a1', grade='P')], verified)
        self.assertEqual((result['credits']['approved'], result['credits']['earned'], result['credits']['proposed']), ('4', '4', '4'))
        failed = self.evaluate([module('m2', 'hss', 'completed', approval_ref='a1', grade='F')], verified)
        self.assertEqual(failed['credits']['earned'], '0')

    def test_cp34_caps_module_size_targets_and_duplicates(self):
        five = self.evaluate([module(f'm{i}', 'open_elective') for i in range(1, 6)])
        self.assertIn('EXPOSURE_CREDIT_CAP', codes(five))
        self.assertEqual(five['credits']['proposed'], '16')
        hss = self.evaluate([module(f'h{i}', 'hss') for i in range(1, 4)])
        self.assertIn('EXPOSURE_TARGET_CAP', codes(hss))
        self.assertEqual(hss['credits']['proposed_by_target'], {'hss': '8'})
        project = self.evaluate([module('p1', 'open_project'), module('p2', 'open_project')])
        self.assertEqual(project['credits']['proposed_by_target'], {'open_project': '4'})
        odd = self.evaluate([module('m1', 'open_elective', credits='3'), module('m2', 'ai_minor'), module('m3', 'open_elective'), module('m3', 'hss')])
        self.assertEqual([m['status'] for m in odd['modules']], ['rejected', 'rejected', 'proposed', 'rejected'])
        self.assertTrue({'INTERNSHIP_MODULE_INVALID', 'INTERNSHIP_TARGET_INVALID', 'INTERNSHIP_MODULE_DUPLICATE'} <= set(codes(odd)))
        twice = self.evaluate([module('m1', 'open_elective', registration_id='att-9')], attempts=[{'id': 'att-9', 'normalized_code': 'IN 498'}])
        self.assertIn('INTERNSHIP_MODULE_DUPLICATE', codes(twice))
        self.assertEqual(twice['credits']['proposed'], '0')

    def test_cp34_no_per_quad_limit_and_load_policy_stays_unknown(self):
        same_quad = self.evaluate([module('m1', 'open_elective', quad_id='Q1'), module('m2', 'open_elective', quad_id='Q1')])
        self.assertEqual(same_quad['credits']['proposed'], '8')  # D-14: quads are not modelled
        self.assertNotIn('QUAD_CREDIT_CAP', codes(same_quad))
        self.assertIn('INTERNSHIP_LOAD_POLICY_UNKNOWN', codes(same_quad))

    def test_cp34_split_proposals_use_only_remaining_needs(self):
        self.assertEqual(propose_split({'open_project': '4', 'hss': '8', 'open_elective': '16'}), ['open_project', 'hss', 'hss', 'open_elective'])
        self.assertEqual(propose_split({'open_project': '0', 'hss': '4', 'open_elective': '4'}), ['hss', 'open_elective'])
        self.assertEqual(propose_split({'open_project': '0', 'hss': '0', 'open_elective': '0'}), [])
        unneeded = self.evaluate([module('p1', 'open_project')], remaining={'open_project': '0', 'hss': '8', 'open_elective': '16'})
        self.assertIn('INTERNSHIP_TARGET_NOT_NEEDED', codes(unneeded))


if __name__ == '__main__':
    unittest.main()
