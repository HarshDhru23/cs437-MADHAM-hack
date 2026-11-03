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

    def test_cp33_exam_window_without_dates_is_unknown_not_clear(self):
        calendar = deepcopy(CALENDAR)
        calendar['terms'][2]['exams'] = [{'start_date': None, 'end_date_exclusive': None}]
        result = evaluate_internship(CONTEXT, internship('six_months', '2027-07-01', '2028-01-01'), PLAN, calendar)
        terms = {t['term_id']: t for t in result['overlapping_terms']}
        self.assertIsNone(terms['2027-28-I']['exam_overlap'])
        missing = [i for i in result['issues'] if i['code'] == 'CALENDAR_MISSING']
        self.assertEqual([(i['severity'], i['entity_refs']) for i in missing], [('unknown', ['2027-28-I'])])
        # A dated exam window that overlaps is a known overlap, whatever the undated one hides.
        calendar['terms'][2]['exams'].append({'start_date': '2027-11-20', 'end_date_exclusive': '2027-12-01'})
        known = evaluate_internship(CONTEXT, internship('six_months', '2027-07-01', '2028-01-01'), PLAN, calendar)
        self.assertIs({t['term_id']: t for t in known['overlapping_terms']}['2027-28-I']['exam_overlap'], True)

    def test_cp33_downstream_courses_are_transitive_and_cycle_safe(self):
        context, plan = deepcopy(CONTEXT), deepcopy(PLAN)
        plan['semesters'] += [{'term_id': '2028-29-I', 'courses': [{'id': 'x1', 'normalized_code': 'ZZ 500', 'credits': '4'}]},
                              {'term_id': '2028-29-II', 'courses': [{'id': 'y1', 'normalized_code': 'ZZ 600', 'credits': '4'}, {'id': 'y2', 'normalized_code': 'ZZ 700', 'credits': '4'}]}]
        # ZZ 500 needs ZZ 400 (w1), which needs ZZ 300 (f1, overlapped). ZZ 600 and ZZ 700 are each other's co-requisites.
        context['catalogue'] = {**CATALOGUE, 'ZZ 500': {'prerequisite_known': True, 'prerequisites': {'type': 'course', 'course_id': 'ZZ 400'}},
                                'ZZ 600': {'prerequisite_known': True, 'prerequisites': {'type': 'and', 'children': [
                                    {'type': 'course', 'course_id': 'ZZ 500'}, {'type': 'course', 'course_id': 'ZZ 700', 'co_requisite': True}]}},
                                'ZZ 700': {'prerequisite_known': True, 'prerequisites': {'type': 'course', 'course_id': 'ZZ 600', 'co_requisite': True}}}
        result = evaluate_internship(context, internship('six_months', '2027-07-01', '2028-01-01'), plan, CALENDAR)
        self.assertEqual(result['downstream_courses'], ['w1', 'x1', 'y1', 'y2'])
        self.assertEqual(sorted(result['affected_courses']), ['f1', 's1'])  # overlapped courses are not also downstream


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

    def test_cp34_failed_module_is_never_approved_and_frees_its_cap(self):
        verified = [{'id': 'a1', 'status': 'verified', 'covered_entities': ['m1', 'm2', 'm3']}]
        for grade in ['F', 'E']:
            failed = self.evaluate([module('m1', 'hss', 'completed', approval_ref='a1', grade=grade)], verified)
            self.assertEqual([(m['status'], m['reasons']) for m in failed['modules']], [('failed', ['INTERNSHIP_MODULE_FAILED'])])
            self.assertEqual((failed['credits']['earned'], failed['credits']['approved'], failed['credits']['proposed']), ('0', '0', '0'))
            self.assertIn('INTERNSHIP_MODULE_FAILED', codes(failed))
        # The failed module takes no HSS slot, so two more HSS modules still fit under the HSS limit of 8.
        retry = self.evaluate([module('m1', 'hss', 'completed', approval_ref='a1', grade='F'), module('m2', 'hss', approval_ref='a1'), module('m3', 'hss')], verified)
        self.assertEqual([m['status'] for m in retry['modules']], ['failed', 'approved', 'proposed'])
        self.assertNotIn('EXPOSURE_TARGET_CAP', codes(retry))
        unverified = self.evaluate([module('m4', 'open_elective', 'completed', grade='F')])
        self.assertEqual((unverified['modules'][0]['status'], unverified['credits']['proposed']), ('failed', '0'))

    def test_cp34_completed_module_without_grade_is_not_earned(self):
        verified = [{'id': 'a1', 'status': 'verified', 'covered_entities': ['m1']}]
        # An unrecognised grade (I, W) is unknown, never a failure: grade_status() maps it to 'unknown'.
        for extra in [{}, {'grade': None}, {'grade': ' '}, {'grade': 'I'}, {'grade': 'W'}]:
            result = self.evaluate([module('m1', 'hss', 'completed', approval_ref='a1', **extra)], verified)
            self.assertEqual((result['modules'][0]['status'], result['credits']['earned'], result['credits']['approved']), ('approved', '0', '4'))
            unknown = [i for i in result['issues'] if i['code'] == 'INTERNSHIP_GRADE_UNKNOWN']
            self.assertEqual([(i['severity'], i['entity_refs']) for i in unknown], [('unknown', ['m1'])])

    def test_cp34_in498_on_the_record_counts_toward_sixteen(self):
        passed = [{'id': f'att-{i}', 'normalized_code': 'IN 498', 'credits': '4', 'grade': 'P', 'completion_status': 'completed', 'term_id': '2026-27-I'} for i in (1, 2)]
        new = [module(f'm{i}', 'open_elective') for i in range(1, 5)]
        result = self.evaluate(new, attempts=passed)
        self.assertEqual([m['status'] for m in result['modules']], ['proposed', 'proposed', 'rejected', 'rejected'])
        self.assertEqual(result['credits']['proposed'], '8')  # 8 on the record + 8 proposed = 16
        self.assertIn('EXPOSURE_CREDIT_CAP', codes(result))
        self.assertNotIn('INTERNSHIP_RECORD_TARGET_UNKNOWN', codes(result))  # open electives have no per-target limit
        other = [{**passed[0], 'completion_status': 'failed', 'grade': 'F'}, {**passed[1], 'normalized_code': 'CS 498'}]
        self.assertEqual(self.evaluate(new, attempts=other)['credits']['proposed'], '16')
        # The record does not store the earlier module's target, so no HSS split is invented for it.
        hss = self.evaluate([module('h1', 'hss'), module('h2', 'hss')], attempts=passed[:1])
        self.assertEqual(hss['credits']['proposed_by_target'], {'hss': '8'})
        unknown = [i for i in hss['issues'] if i['code'] == 'INTERNSHIP_RECORD_TARGET_UNKNOWN']
        self.assertEqual([(i['severity'], i['entity_refs']) for i in unknown], [('unknown', ['att-1', 'h1', 'h2'])])

    def test_cp34_completed_module_without_registration_may_already_be_on_the_record(self):
        # A completed module with no registration_id may be the IN 498 attempt already on the record, so it is not counted
        # on top of it: 4 on the record (e1) + 12 proposed = 16 (D-14), nothing is rejected, and the match stays unknown.
        passed = [{'id': f'att-{i}', 'normalized_code': 'IN 498', 'credits': '4', 'grade': 'P', 'completion_status': 'completed', 'term_id': '2026-27-I'} for i in (1, 2, 3, 4)]
        verified = [{'id': 'a1', 'status': 'verified', 'covered_entities': ['e1', 'e2']}]
        e1 = module('e1', 'open_elective', 'completed', approval_ref='a1', grade='P')
        proposals = [module(f'x{i}', 'open_elective') for i in (1, 2, 3)]
        result = self.evaluate([e1] + proposals, verified, passed[:1])
        self.assertEqual([m['status'] for m in result['modules']], ['earned', 'proposed', 'proposed', 'proposed'])
        self.assertNotIn('EXPOSURE_CREDIT_CAP', codes(result))
        match = [i for i in result['issues'] if i['code'] == 'INTERNSHIP_RECORD_MATCH_UNKNOWN']
        self.assertEqual([(i['severity'], i['entity_refs']) for i in match], [('unknown', ['att-1', 'e1'])])
        # Four modules on the record already fill the cap; e1 may be one of them, so it is kept, but a proposal is rejected.
        full = self.evaluate([e1, proposals[0]], verified, passed)
        self.assertEqual([m['status'] for m in full['modules']], ['earned', 'rejected'])
        # A registration that is not on the record makes it a separate module: it counts, so x3 no longer fits.
        separate = self.evaluate([{**e1, 'registration_id': 'reg-new'}] + proposals, verified, passed[:1])
        self.assertEqual([m['status'] for m in separate['modules']], ['earned', 'proposed', 'proposed', 'rejected'])
        self.assertNotIn('INTERNSHIP_RECORD_MATCH_UNKNOWN', codes(separate))
        # One record attempt can be at most one of two unregistered completed modules: 4 + 4 + 8 proposed = 16.
        two = self.evaluate([e1, {**e1, 'id': 'e2'}] + proposals, verified, passed[:1])
        self.assertEqual([m['status'] for m in two['modules']], ['earned', 'earned', 'proposed', 'proposed', 'rejected'])
        # Proposed modules are not done yet, so they can never be the record's attempt.
        self.assertEqual([m['status'] for m in self.evaluate(proposals + [module('x4', 'open_elective')], attempts=passed[:1])['modules']],
                         ['proposed', 'proposed', 'proposed', 'rejected'])

    def test_cp34_cap_keeps_earned_and_approved_before_proposed(self):
        verified = [{'id': 'a1', 'status': 'verified', 'covered_entities': ['e1', 'a2', 'h3']}]
        proposed = [module(f'm{i}', 'open_elective') for i in range(1, 5)]
        late = self.evaluate(proposed + [module('e1', 'open_elective', 'completed', approval_ref='a1', grade='P')], verified)
        self.assertEqual([m['status'] for m in late['modules']], ['proposed', 'proposed', 'proposed', 'rejected', 'earned'])
        self.assertEqual((late['credits']['earned'], late['credits']['proposed']), ('4', '12'))
        approved = self.evaluate(proposed + [module('a2', 'open_elective', approval_ref='a1')], verified)
        self.assertEqual((approved['credits']['approved'], approved['credits']['proposed']), ('4', '12'))
        self.assertEqual([m['reasons'] for m in approved['modules']], [[], [], [], ['EXPOSURE_CREDIT_CAP'], []])  # the last proposal goes
        hss = self.evaluate([module('h1', 'hss'), module('h2', 'hss'), module('h3', 'hss', 'completed', approval_ref='a1', grade='P')], verified)
        self.assertEqual([m['status'] for m in hss['modules']], ['proposed', 'rejected', 'earned'])
        self.assertEqual((hss['credits']['earned_by_target'], hss['credits']['proposed_by_target']), ({'hss': '4'}, {'hss': '4'}))

    def test_cp34_one_registration_counts_once_across_modules(self):
        shared = self.evaluate([module('m1', 'open_elective', registration_id='r1'), module('m2', 'open_elective', registration_id='r1'),
                                module('m3', 'open_elective')])
        self.assertEqual([(m['status'], m['reasons']) for m in shared['modules']], [('proposed', []), ('rejected', ['INTERNSHIP_MODULE_DUPLICATE']), ('proposed', [])])
        self.assertEqual(shared['credits']['proposed'], '8')

    def test_cp34_no_per_quad_limit_and_load_policy_stays_unknown(self):
        same_quad = self.evaluate([module('m1', 'open_elective', quad_id='Q1'), module('m2', 'open_elective', quad_id='Q1')])
        self.assertEqual(same_quad['credits']['proposed'], '8')  # D-14: quads are not modelled
        self.assertNotIn('QUAD_CREDIT_CAP', codes(same_quad))
        self.assertIn('INTERNSHIP_LOAD_POLICY_UNKNOWN', codes(same_quad))

    def test_cp34_split_proposals_use_only_remaining_needs(self):
        self.assertEqual(propose_split({'open_project': '4', 'hss': '8', 'open_elective': '16'})['targets'], ['open_project', 'hss', 'hss', 'open_elective'])
        self.assertEqual(propose_split({'open_project': '0', 'hss': '4', 'open_elective': '4'})['targets'], ['hss', 'open_elective'])
        self.assertEqual(propose_split({'open_project': '0', 'hss': '0', 'open_elective': '0'})['targets'], [])
        unneeded = self.evaluate([module('p1', 'open_project')], remaining={'open_project': '0', 'hss': '8', 'open_elective': '16'})
        self.assertIn('INTERNSHIP_TARGET_NOT_NEEDED', codes(unneeded))

    def test_cp34_missing_remaining_bucket_is_unknown_not_zero(self):
        for remaining in [{'open_elective': '16'}, {'hss': None, 'open_elective': '16', 'open_project': '4'}]:
            result = self.evaluate([module('h1', 'hss')], remaining=remaining)
            self.assertNotIn('INTERNSHIP_TARGET_NOT_NEEDED', codes(result))
            unknown = [i for i in result['issues'] if i['code'] == 'INTERNSHIP_TARGET_NEED_UNKNOWN']
            self.assertEqual([(i['severity'], i['entity_refs']) for i in unknown], [('unknown', ['h1'])])
            self.assertEqual(result['credits']['proposed'], '4')
        known_zero = self.evaluate([module('h1', 'hss')], remaining={'hss': '0', 'open_elective': '16', 'open_project': '4'})
        self.assertIn('INTERNSHIP_TARGET_NOT_NEEDED', codes(known_zero))
        split = propose_split({'open_elective': '16'})
        self.assertEqual(split['targets'], ['open_elective'] * 4)
        self.assertEqual([(i['code'], i['severity'], i['entity_refs']) for i in split['issues']],
                         [('INTERNSHIP_TARGET_NEED_UNKNOWN', 'unknown', ['open_project']), ('INTERNSHIP_TARGET_NEED_UNKNOWN', 'unknown', ['hss'])])
        self.assertEqual(propose_split({'open_project': '4', 'hss': '8', 'open_elective': '16'})['issues'], [])


if __name__ == '__main__':
    unittest.main()
