"""The committed official 2026-27 timetables (CP-23, CP-24; D-22, D-23).

Expected slots and dates are read by hand from the two committed timetables and the
Semester I `Time Slots` legend (row "11:30 - 12:50": M F1, Th F2; row "10:00 - 11:20":
W E1, F E2; row "17:00 - 18:20": W P1, F P2; row "15:30 - 16:50": W M1, F M2), and from
the 2026-27 calendar quads (D-24).
"""
import hashlib
import json
import unittest
from pathlib import Path
from coursepath.data_sources.official_timetables import OFFICIAL_SOURCES, build_official_snapshot, load_committed_snapshots
from coursepath.offerings import offering_availability
from coursepath.semester_plan import validate_plan
from coursepath.timetable import check_meetings

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOTS = {s['term_id']: s for s in load_committed_snapshots()}


def offering(term_id, display_code):
    return next(o for o in SNAPSHOTS[term_id]['offerings'] if o['display_code'] == display_code)


def lecture(term_id, display_code):
    group = next(g for g in offering(term_id, display_code)['meeting_groups'] if g['kind'] == 'lecture')
    return [(m['original_slot'], m['weekday'], m['start_minute'], m['end_minute'], m['active_start_date'], m['active_end_date']) for m in group['meetings']]


def item(item_id, code):
    return {'id': item_id, 'normalized_code': code}


class OfficialSnapshotTests(unittest.TestCase):
    def test_cp23_committed_snapshots_are_the_reviewed_complete_build_of_the_committed_sources(self):
        self.assertEqual(sorted(SNAPSHOTS), ['2026-27-I', '2026-27-II'])
        for term_id, source in OFFICIAL_SOURCES.items():
            with self.subTest(term=term_id):
                snapshot = SNAPSHOTS[term_id]
                self.assertEqual((snapshot['review_status'], snapshot['coverage']), ('reviewed', 'complete'))
                digest = hashlib.sha256((ROOT / source['path']).read_bytes()).hexdigest()
                self.assertEqual(snapshot['source_refs'][0]['file_sha256'], digest)
                # Rebuilding from the committed sources reproduces the committed file exactly, so data and code cannot drift.
                rebuilt, _ = build_official_snapshot(term_id)
                self.assertEqual(json.loads(json.dumps(rebuilt)), snapshot)

    def test_cp24_slots_and_half_semester_dates_come_from_the_sources(self):
        # Semester I: MA 205 (first half) and MA 206 (second half) share F1 (Mon 11:30) and F2 (Thu 11:30).
        self.assertEqual(lecture('2026-27-I', 'MA 205'), [('F1', 0, 690, 770, '2026-08-04', '2026-09-18'), ('F2', 3, 690, 770, '2026-08-04', '2026-09-18')])
        self.assertEqual(lecture('2026-27-I', 'MA 206'), [('F1', 0, 690, 770, '2026-09-24', '2026-11-20'), ('F2', 3, 690, 770, '2026-09-24', '2026-11-20')])
        self.assertEqual(lecture('2026-27-I', 'CS 330'), [('E1', 2, 600, 680, '2026-08-04', '2026-11-20'), ('E2', 4, 600, 680, '2026-08-04', '2026-11-20')])
        # Semester II has no slot legend of its own and is read with the Semester I legend (D-22).
        self.assertEqual(lecture('2026-27-II', 'CS 432'), [('P1', 2, 1020, 1100, '2027-01-04', '2027-04-23'), ('P2', 4, 1020, 1100, '2027-01-04', '2027-04-23')])
        self.assertEqual(lecture('2026-27-II', 'CE 641')[0][4:], ('2027-02-25', '2027-04-23'))
        self.assertEqual(lecture('2026-27-II', 'MA 104 (E)')[0][4:], ('2027-01-04', '2027-02-19'))
        self.assertIn('SLOT_LEGEND_FROM_OTHER_TERM', [i['code'] for i in SNAPSHOTS['2026-27-II']['issues']])
        self.assertNotIn('SLOT_LEGEND_FROM_OTHER_TERM', [i['code'] for i in SNAPSHOTS['2026-27-I']['issues']])

    def test_cp24_real_clashes_respect_half_semester_dates(self):
        spring = SNAPSHOTS['2026-27-II']
        clash = check_meetings([item('db', 'CS 432'), item('bio', 'BE 304')], spring)
        self.assertEqual((clash['status'], [c['certain'] for c in clash['conflicts']]), ('conflicts', [True, True]))
        # CE 641 (second half) shares M1, M2 with full-term CS 607 but not with ME 692-XII (first half).
        self.assertEqual(check_meetings([item('water', 'CE 641'), item('comb', 'CS 607')], spring)['status'], 'conflicts')
        battery = {**item('battery', 'ME 692'), 'offering_id': '2026-27-II:ME692-XII'}  # ME 692-IX shares the code
        self.assertEqual(check_meetings([item('water', 'CE 641'), battery], spring)['status'], 'clear')
        autumn = SNAPSHOTS['2026-27-I']
        self.assertEqual(check_meetings([item('calc', 'MA 205'), item('complex', 'MA 206')], autumn)['status'], 'clear')

    def test_cp23_a_course_missing_from_a_complete_official_list_is_not_offered(self):
        absent = offering_availability(list(SNAPSHOTS.values()), '2026-27-II', 'ZZ 999')
        self.assertEqual(absent['status'], 'not_offered')
        present = offering_availability(list(SNAPSHOTS.values()), '2026-27-II', 'CS 432')
        self.assertEqual((present['status'], present['offering_ids']), ('confirmed_in_snapshot', ['2026-27-II:CS432']))


class SameParityHintTests(unittest.TestCase):
    """D-23: a later I or II term with no timetable uses the latest earlier same-parity timetable as a hint only."""

    def test_cp23_later_terms_get_a_historical_hint_never_a_confirmation(self):
        snapshots = list(SNAPSHOTS.values())
        hint = offering_availability(snapshots, '2027-28-II', 'CS 432')
        self.assertEqual((hint['status'], hint['offering_ids'], hint['pattern_term_id']), ('historical', [], '2026-27-II'))
        self.assertEqual([i['code'] for i in hint['issues']], ['OFFERING_HISTORICAL_ONLY'])
        self.assertEqual(offering_availability(snapshots, '2027-28-I', 'MA 205')['status'], 'historical')
        # Parity matters: CS 432 is listed only in Semester II.
        self.assertEqual(offering_availability(snapshots, '2027-28-I', 'CS 432')['status'], 'unknown')
        # A course missing from the earlier list stays unknown, never "not offered"; summer terms get no hint.
        self.assertEqual(offering_availability(snapshots, '2027-28-II', 'ZZ 999')['status'], 'unknown')
        self.assertEqual(offering_availability(snapshots, '2027-28-SUMMER', 'CS 432')['status'], 'unknown')
        # An earlier year never borrows from a later one.
        self.assertEqual(offering_availability(snapshots, '2025-26-II', 'CS 432')['status'], 'unknown')

    def test_cp24_hints_never_supply_meetings(self):
        plan = {'semesters': [{'term_id': '2027-28-II', 'courses': [{'id': 'db', 'normalized_code': 'CS 432', 'credits': '4'},
                                                                     {'id': 'bio', 'normalized_code': 'BE 304', 'credits': '4'}]}]}
        result = validate_plan({}, plan, list(SNAPSHOTS.values()))
        self.assertEqual(result['meeting_checks']['2027-28-II']['status'], 'not_checked')
        self.assertEqual([row['offering_status'] for row in result['per_course']], ['historical', 'historical'])


class LabAndTutorialAlternativesTests(unittest.TestCase):
    """D-26 (Harsh, 7 Nov 2026): the slots a lab or tutorial lists are alternatives, one per student. Lectures keep every slot."""

    def all_groups(self, term_id):
        return [(o['display_code'], g) for o in SNAPSHOTS[term_id]['offerings'] for g in o['meeting_groups']]

    def test_cp24_multi_slot_labs_and_tutorials_are_choose_one_and_nothing_else_changed(self):
        # Counts were read from the committed files before D-26: Semester I had 42 labs + 8 tutorials with 2+ slots, Semester II 33 + 2.
        expected = {'2026-27-I': (42, 8), '2026-27-II': (33, 2)}
        for term_id, (labs, tutorials) in expected.items():
            with self.subTest(term=term_id):
                found = {'lab': 0, 'tutorial': 0}
                for code, group in self.all_groups(term_id):
                    if group['unresolved'] or not group['meetings']:
                        self.assertEqual(group['selection_semantics'], 'unknown', f"{code} {group['kind']}: unresolved text is never guessed")
                    elif group['kind'] in found and len(group['meetings']) >= 2:
                        found[group['kind']] += 1
                        self.assertEqual(group['selection_semantics'], 'choose_one', f"{code} {group['kind']}")
                    else:
                        self.assertEqual(group['selection_semantics'], 'all_required', f"{code} {group['kind']}: lectures and single slots stay required")
                self.assertEqual((found['lab'], found['tutorial']), (labs, tutorials))

    def test_cp24_no_stated_semantics_issue_is_left_for_resolved_groups_and_other_issues_are_untouched(self):
        remaining = {'2026-27-I': {'ROW_UNRECOGNIZED': 38, 'MEETING_TEXT_UNPARSED': 4, 'DUPLICATE_CODE_CONFLICT': 2, 'SOURCE_COLUMN_EMPTY': 2},
                     '2026-27-II': {'ROW_UNRECOGNIZED': 25, 'MEETING_TEXT_UNPARSED': 2, 'SOURCE_COLUMN_EMPTY': 2, 'DUPLICATE_CODE_CONFLICT': 1,
                                    'SHEET_MISSING': 1, 'SLOT_LEGEND_FROM_OTHER_TERM': 1}}
        for term_id, counts in remaining.items():
            with self.subTest(term=term_id):
                codes = [i['code'] for i in SNAPSHOTS[term_id]['issues']]
                self.assertNotIn('MEETING_SEMANTICS_UNKNOWN', codes)
                self.assertEqual({c: codes.count(c) for c in set(codes)}, counts)

    def test_cp24_real_cs202_lab_alternatives_clash_only_when_the_assigned_slot_does(self):
        # CS 202's lab is J2 (Fri 14:00) or M2 (Fri 15:30); CH 528 has a lecture in J2 and none in M2.
        snapshot, j2, m2 = SNAPSHOTS['2026-27-I'], '2026-27-I:CS202:lab:J2', '2026-27-I:CS202:lab:M2'
        items = lambda **extra: [{'id': 'tools', 'normalized_code': 'CS 202', **extra}, {'id': 'chem', 'normalized_code': 'CH 528'}]
        # Slot not known yet: a possible clash (warning), never certain and never clear.
        possible = check_meetings(items(), snapshot)
        self.assertEqual(possible['status'], 'conflicts')
        self.assertEqual([(c['certain'], sorted(c['item_ids'])) for c in possible['conflicts']], [(False, ['chem', 'tools'])])
        self.assertIn(j2, possible['conflicts'][0]['meeting_ids'])
        self.assertEqual([i['severity'] for i in possible['issues'] if i['code'] == 'TIMETABLE_CONFLICT'], ['warning'])
        # Assigned the M2 slot: nothing overlaps.
        free = check_meetings(items(section_ids=[m2]), snapshot)
        self.assertEqual((free['status'], free['conflicts']), ('clear', []))
        # Assigned the J2 slot: both meetings are dated and required, so the clash is certain.
        certain = check_meetings(items(section_ids=[j2]), snapshot)
        self.assertEqual([c['certain'] for c in certain['conflicts']], [True])
        self.assertEqual([i['severity'] for i in certain['issues'] if i['code'] == 'TIMETABLE_CONFLICT'], ['error'])


if __name__ == '__main__':
    unittest.main()
