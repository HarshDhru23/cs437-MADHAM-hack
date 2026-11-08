"""H11 offering availability and meeting clashes (CP-23, CP-24).

Expected values come from docs/team/source-findings.md (slot times and the
PH 202 / ES 667 / CS 331 regression rows) and the contract rule that touching
intervals do not overlap. Snapshots are built by Manashree's adapter from a
synthetic workbook, so the adapter -> clash-check seam is exercised too.
"""
from copy import deepcopy
import tempfile
import unittest
from pathlib import Path
from coursepath.data_sources.timetable_xlsx import build_snapshot
from coursepath.offerings import offering_availability
from coursepath.timetable import check_meetings
from coursepath.semester_plan import validate_plan
from tests.data_sources.workbook_factory import build_workbook, course_row

TERM = '2026-27-I'
ROWS = [course_row('PH 202', 'Synthetic Physics', 4, 'B1, B2', 'H2'),
        course_row('ES 667', 'Synthetic Deep Learning', 4, 'B1, B2'),
        course_row('CS 331', 'Synthetic Networks', 4, 'D1', 'H2'),
        course_row('CS 202', 'Synthetic Tools', 4, 'D1', '', 'J2, M2'),
        course_row('CS 329', 'Synthetic Agents', 4, 'H1'),
        course_row('ES 112', 'Synthetic Computing', 4, 'J2')]


def adapter_snapshot(rows=ROWS):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'synthetic.xlsx'
        build_workbook(path, rows)
        snapshot, _ = build_snapshot(path, TERM, 'SRC-SYNTHETIC')
    return snapshot


def reviewed(snapshot, coverage='complete'):
    return {**deepcopy(snapshot), 'review_status': 'reviewed', 'coverage': coverage}


def item(item_id, code, **extra):
    return {'id': item_id, 'normalized_code': code, 'credits': '4', **extra}


def meeting(meeting_id, weekday, start, end, dates=(None, None)):
    return {'id': meeting_id, 'kind': 'lecture', 'weekday': weekday, 'start_minute': start, 'end_minute': end,
            'active_start_date': dates[0], 'active_end_date': dates[1], 'original_slot': 'X1',
            'source_refs': [{'id': 'SRC-HAND', 'locator': 'hand!' + meeting_id}]}


def hand_snapshot(*offerings):
    return {'id': 'hand', 'term_id': TERM, 'coverage': 'complete', 'review_status': 'reviewed', 'source_refs': [],
            'offerings': [{'id': f'{TERM}:{code}', 'code': code, 'display_code': code, 'credits': '4', 'term_id': TERM,
                           'availability_status': 'confirmed_in_snapshot', 'source_refs': [],
                           'meeting_groups': [{'id': f'{TERM}:{code}:lecture', 'kind': 'lecture', 'selection_semantics': semantics,
                                               'unresolved': [], 'meetings': meetings, 'source_refs': []}]}
                          for code, semantics, meetings in offerings]}


class OfferingAvailabilityTests(unittest.TestCase):
    def test_cp23_snapshot_coverage_and_review_decide_availability(self):
        snapshot = adapter_snapshot()
        complete = reviewed(snapshot)
        self.assertEqual(offering_availability(complete, TERM, 'CS 331')['status'], 'confirmed_in_snapshot')
        self.assertEqual(offering_availability(complete, TERM, 'ZZ 999')['status'], 'not_offered')
        # Absence from a partial or unreviewed list proves nothing.
        self.assertEqual(offering_availability(reviewed(snapshot, 'partial'), TERM, 'ZZ 999')['status'], 'unknown')
        self.assertEqual(offering_availability(snapshot, TERM, 'ZZ 999')['status'], 'unknown')
        # A draft snapshot is evidence, not confirmation.
        draft = offering_availability(snapshot, TERM, 'CS 331')
        self.assertEqual(draft['status'], 'tentative')
        self.assertIn('OFFERING_SNAPSHOT_UNREVIEWED', [i['code'] for i in draft['issues']])
        self.assertTrue(draft['source_refs'])

    def test_cp23_current_snapshot_never_confirms_a_later_term(self):
        complete = reviewed(adapter_snapshot())
        later = offering_availability(complete, '2026-27-II', 'CS 331')
        self.assertEqual(later['status'], 'unknown')
        self.assertIn('OFFERING_UNKNOWN', [i['code'] for i in later['issues']])
        self.assertEqual(offering_availability(None, TERM, 'CS 331')['status'], 'unknown')
        historical = deepcopy(complete)
        for offering in historical['offerings']:
            offering['availability_status'] = 'historical'
        self.assertEqual(offering_availability(historical, TERM, 'CS 331')['status'], 'historical')

    def test_cp23_a_current_variant_outranks_a_historical_one(self):
        complete = reviewed(adapter_snapshot())
        current = next(o for o in complete['offerings'] if o['code'] == 'CS 331')
        complete['offerings'].insert(0, {**deepcopy(current), 'id': current['id'] + '#old', 'availability_status': 'historical'})
        self.assertEqual(offering_availability(complete, TERM, 'CS 331')['status'], 'confirmed_in_snapshot')
        self.assertEqual(offering_availability({**complete, 'review_status': 'draft'}, TERM, 'CS 331')['status'], 'tentative')


class MeetingClashTests(unittest.TestCase):
    def test_cp24_ph202_es667_lectures_clash_on_both_weekly_meetings(self):
        result = check_meetings([item('p', 'PH 202'), item('e', 'ES 667')], reviewed(adapter_snapshot()))
        self.assertEqual(result['status'], 'conflicts')
        lectures = [c for c in result['conflicts'] if c['kinds'] == ['lecture', 'lecture']]
        self.assertEqual(sorted(c['weekday'] for c in lectures), [1, 4])  # B1 Tuesday, B2 Friday
        for conflict in lectures:
            self.assertEqual(sorted(conflict['item_ids']), ['e', 'p'])
            self.assertEqual(len(conflict['meeting_ids']), 2)
            self.assertTrue(all(ref['locator'].startswith('Time table!K') for ref in conflict['source_refs']))
        self.assertEqual(result['per_item'], {'p': 'conflicts', 'e': 'conflicts'})

    def test_cp24_tutorial_clash_is_reported_when_lectures_differ(self):
        result = check_meetings([item('p', 'PH 202'), item('n', 'CS 331')], reviewed(adapter_snapshot()))
        self.assertEqual([(c['kinds'], c['weekday']) for c in result['conflicts']], [(['tutorial', 'tutorial'], 2)])

    def test_cp24_touching_and_distinct_times_are_clear(self):
        snapshot = hand_snapshot(('ZZ 100', 'all_required', [meeting('a', 1, 510, 590)]),
                                 ('ZZ 200', 'all_required', [meeting('b', 1, 590, 670)]))
        result = check_meetings([item('x', 'ZZ 100'), item('y', 'ZZ 200')], snapshot)
        self.assertEqual((result['status'], result['conflicts']), ('clear', []))
        self.assertEqual(check_meetings([item('p', 'PH 202'), item('s', 'CS 329')], reviewed(adapter_snapshot()))['status'], 'clear')

    def test_cp24_half_semester_dates_decide_and_unknown_dates_stay_conditional(self):
        first = ('2026-08-01', '2026-10-01')
        second = ('2026-10-01', '2026-12-01')
        snapshot = hand_snapshot(('ZZ 100', 'all_required', [meeting('a', 1, 510, 590, first)]),
                                 ('ZZ 200', 'all_required', [meeting('b', 1, 510, 590, second)]))
        self.assertEqual(check_meetings([item('x', 'ZZ 100'), item('y', 'ZZ 200')], snapshot)['status'], 'clear')
        snapshot['offerings'][1]['meeting_groups'][0]['meetings'][0].update(active_start_date='2026-09-01', active_end_date='2026-11-01')
        certain = check_meetings([item('x', 'ZZ 100'), item('y', 'ZZ 200')], snapshot)
        self.assertEqual([c['certain'] for c in certain['conflicts']], [True])
        self.assertEqual([i['severity'] for i in certain['issues'] if i['code'] == 'TIMETABLE_CONFLICT'], ['error'])
        # Undated meetings in the same slot may clash: report, never clear, never certain.
        undated = hand_snapshot(('ZZ 100', 'all_required', [meeting('a', 1, 510, 590)]), ('ZZ 200', 'all_required', [meeting('b', 1, 510, 590, second)]))
        possible = check_meetings([item('x', 'ZZ 100'), item('y', 'ZZ 200')], undated)
        self.assertEqual((possible['status'], [c['certain'] for c in possible['conflicts']]), ('conflicts', [False]))
        self.assertEqual([i['severity'] for i in possible['issues'] if i['code'] == 'TIMETABLE_CONFLICT'], ['warning'])

    def test_cp24_dated_meetings_clash_only_when_a_shared_date_falls_on_their_weekday(self):
        def check(weekday, first, second):
            snapshot = hand_snapshot(('ZZ 100', 'all_required', [meeting('a', weekday, 510, 590, first)]),
                                     ('ZZ 200', 'all_required', [meeting('b', weekday, 510, 590, second)]))
            return check_meetings([item('x', 'ZZ 100'), item('y', 'ZZ 200')], snapshot)
        # Weekday 0 is Monday. The shared range [29 Sep, 30 Sep) holds only Tuesday 29 Sep 2026.
        early, late = ('2026-08-01', '2026-09-30'), ('2026-09-29', '2026-12-01')
        monday = check(0, early, late)
        self.assertEqual((monday['status'], monday['conflicts']), ('clear', []))
        self.assertEqual([c['certain'] for c in check(1, early, late)['conflicts']], [True])
        # End-exclusive: [23 Sep, 29 Sep) runs Wednesday to Monday, so it holds Monday 28 Sep but no Tuesday.
        early, late = ('2026-08-01', '2026-09-29'), ('2026-09-23', '2026-12-01')
        self.assertEqual(check(1, early, late)['status'], 'clear')
        self.assertEqual(check(0, early, late)['status'], 'conflicts')

    def test_cp24_alternative_groups_need_a_selection_before_a_clash_is_certain(self):
        options = [meeting('lab-a', 4, 840, 920, ('2026-08-01', '2026-12-01')), meeting('lab-b', 4, 930, 1010, ('2026-08-01', '2026-12-01'))]
        snapshot = hand_snapshot(('ZZ 100', 'choose_one', options),
                                 ('ZZ 200', 'all_required', [meeting('busy', 4, 840, 920, ('2026-08-01', '2026-12-01'))]))
        unselected = check_meetings([item('x', 'ZZ 100'), item('y', 'ZZ 200')], snapshot)
        self.assertEqual([c['certain'] for c in unselected['conflicts']], [False])
        free = check_meetings([item('x', 'ZZ 100', section_ids=['lab-b']), item('y', 'ZZ 200')], snapshot)
        self.assertEqual((free['status'], free['conflicts']), ('clear', []))
        chosen = check_meetings([item('x', 'ZZ 100', section_ids=['lab-a']), item('y', 'ZZ 200')], snapshot)
        self.assertEqual([c['certain'] for c in chosen['conflicts']], [True])
        self.assertIn('SECTION_UNKNOWN', [i['code'] for i in check_meetings([item('x', 'ZZ 100', section_ids=['nope'])], snapshot)['issues']])

    def test_cp24_unknown_lab_semantics_report_possible_clash_but_clear_when_none_can_clash(self):
        snapshot = reviewed(adapter_snapshot())
        # CS 202 lab J2,M2 are alternatives (D-26); ES 112 meets in J2.
        possible = check_meetings([item('t', 'CS 202'), item('c', 'ES 112')], snapshot)
        self.assertEqual([c['certain'] for c in possible['conflicts']], [False])
        # Neither J2 nor M2 can meet CS 329's H1 slot, so either reading is clash-free.
        self.assertEqual(check_meetings([item('t', 'CS 202'), item('s', 'CS 329')], snapshot)['status'], 'clear')

    def test_cp24_missing_snapshot_meetings_or_variant_choice_is_not_checked(self):
        snapshot = reviewed(adapter_snapshot())
        self.assertEqual(check_meetings([item('p', 'PH 202')], None)['status'], 'not_checked')
        absent = check_meetings([item('p', 'PH 202'), item('z', 'ZZ 999')], snapshot)
        self.assertEqual((absent['status'], absent['per_item']['z']), ('not_checked', 'not_checked'))
        self.assertIn('MEETINGS_UNKNOWN', [i['code'] for i in absent['issues']])
        unresolved = deepcopy(snapshot)
        group = next(o for o in unresolved['offerings'] if o['code'] == 'CS 331')['meeting_groups'][0]
        group['unresolved'] = ['Z9']
        self.assertEqual(check_meetings([item('n', 'CS 331')], unresolved)['per_item']['n'], 'not_checked')
        variants = deepcopy(snapshot)
        twin = deepcopy(next(o for o in variants['offerings'] if o['code'] == 'CS 331'))
        variants['offerings'].append({**twin, 'id': twin['id'] + '#v2'})
        ambiguous = check_meetings([item('n', 'CS 331')], variants)
        self.assertEqual(ambiguous['per_item']['n'], 'not_checked')
        self.assertIn('OFFERING_SECTION_REQUIRED', [i['code'] for i in ambiguous['issues']])
        self.assertEqual(check_meetings([item('n', 'CS 331', offering_id=twin['id'] + '#v2')], variants)['per_item']['n'], 'clear')

    def test_cp24_stale_offering_variant_is_an_error_not_missing_meetings(self):
        stale = f'{TERM}:CS331#withdrawn'
        result = check_meetings([item('n', 'CS 331', offering_id=stale)], reviewed(adapter_snapshot()))
        self.assertEqual(result['per_item']['n'], 'not_checked')
        self.assertEqual([(i['code'], i['severity'], i['entity_refs']) for i in result['issues']],
                         [('OFFERING_VARIANT_UNKNOWN', 'error', ['n', stale])])

    def test_cp24_conflict_ids_stay_unique_when_a_course_is_planned_twice(self):
        result = check_meetings([item('p1', 'PH 202'), item('p2', 'PH 202'), item('e', 'ES 667')], reviewed(adapter_snapshot()))
        # p1/p2 share B1, B2 and H2; each copy also meets ES 667 in B1 and B2.
        self.assertEqual(len(result['conflicts']), 7)
        self.assertEqual(len({c['id'] for c in result['conflicts']}), 7)

    def test_cp24_duplicated_source_meetings_do_not_double_conflicts(self):
        snapshot = reviewed(adapter_snapshot(ROWS + [course_row('ES 667', 'Synthetic Deep Learning', 4, 'B1, B2')]))
        self.assertEqual(len([o for o in snapshot['offerings'] if o['code'] == 'ES 667']), 1)
        result = check_meetings([item('p', 'PH 202'), item('e', 'ES 667')], snapshot)
        self.assertEqual(len(result['conflicts']), 2)
        doubled = deepcopy(snapshot)
        group = next(o for o in doubled['offerings'] if o['code'] == 'ES 667')['meeting_groups'][0]
        group['meetings'] = group['meetings'] + deepcopy(group['meetings'])
        self.assertEqual(len(check_meetings([item('p', 'PH 202'), item('e', 'ES 667')], doubled)['conflicts']), 2)
        self.assertEqual(check_meetings([item('e', 'ES 667')], doubled)['status'], 'clear')


class PlanValidationWithSnapshotTests(unittest.TestCase):
    def test_cp24_plan_validation_reports_term_checks_and_keeps_history_credits(self):
        snapshot = reviewed(adapter_snapshot())
        history = [{'id': 'h', 'normalized_code': 'ES 112', 'credits': '3', 'grade': 'B', 'term_id': '2024-25-I', 'completion_status': 'completed'}]
        before = deepcopy(history)
        plan = {'semesters': [{'term_id': TERM, 'courses': [item('p', 'PH 202'), item('e', 'ES 667'), item('x', 'CS 331', credits='3')]},
                              {'term_id': '2026-27-II', 'courses': [item('l', 'CS 329')]}]}
        result = validate_plan({'attempts': history}, plan, snapshot)
        self.assertEqual(history, before)
        rows = {row['id']: row for row in result['per_course']}
        self.assertEqual((rows['p']['offering_status'], rows['p']['meeting_check_status']), ('confirmed_in_snapshot', 'conflicts'))
        self.assertEqual((rows['l']['offering_status'], rows['l']['meeting_check_status']), ('unknown', 'not_checked'))
        self.assertEqual(result['meeting_checks'][TERM]['status'], 'conflicts')
        self.assertEqual(result['meeting_checks']['2026-27-II']['status'], 'not_checked')
        self.assertEqual(result['meeting_check_status'], 'conflicts')
        codes = [(i['code'], tuple(i['entity_refs'])) for i in result['issues']]
        self.assertIn(('OFFERING_CREDITS_DIFFER', ('x',)), codes)
        self.assertNotIn(('OFFERING_UNKNOWN', ('p',)), codes)

    def test_cp24_plan_without_snapshot_never_reports_clear(self):
        plan = {'semesters': [{'term_id': TERM, 'courses': [item('s', 'CS 329')]}]}
        result = validate_plan({}, plan)
        self.assertEqual(result['meeting_check_status'], 'not_checked')
        self.assertEqual(result['per_course'][0]['offering_status'], 'unknown')

    def test_cp24_empty_term_is_not_checked_with_or_without_a_snapshot(self):
        # Nothing selected means nothing was compared, so an empty term never reads as clear.
        snapshot = reviewed(adapter_snapshot())
        self.assertEqual(check_meetings([], None)['status'], 'not_checked')
        self.assertEqual(check_meetings([], snapshot)['status'], 'not_checked')
        empty = validate_plan({}, {'semesters': [{'term_id': '2027-28-I', 'courses': [], 'placeholders': []}]})
        self.assertEqual((empty['meeting_checks']['2027-28-I']['status'], empty['meeting_check_status']), ('not_checked', 'not_checked'))
        plan = {'semesters': [{'term_id': TERM, 'courses': [item('p', 'PH 202'), item('s', 'CS 329')]},
                              {'term_id': '2027-28-I', 'courses': [], 'placeholders': []}]}
        result = validate_plan({}, plan, snapshot)
        self.assertEqual(result['meeting_checks'][TERM]['status'], 'clear')
        self.assertEqual((result['meeting_checks']['2027-28-I']['status'], result['meeting_check_status']), ('not_checked', 'not_checked'))
        # A placeholder beside clash-free courses is still an unchecked selection.
        plan['semesters'][0]['placeholders'] = [{'id': 'ph', 'requirement_id': 'r', 'desired_credits': '4'}]
        self.assertEqual(validate_plan({}, plan, snapshot)['meeting_checks'][TERM]['status'], 'not_checked')


if __name__ == '__main__':
    unittest.main()
