import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from coursepath.data_sources.timetable_xlsx import build_snapshot
from tests.data_sources.workbook_factory import build_workbook, course_row

ROOT = Path(__file__).resolve().parents[2]
TERM = "2026-27-I"


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = Path(self._tmp.name) / "tt.xlsx"

    def build(self, rows, **kw):
        build_workbook(self.path, rows, **kw)
        return build_snapshot(self.path, TERM, "SRC-TT")

    def edit(self, fn):
        wb = load_workbook(self.path)
        fn(wb)
        wb.save(self.path)
        return build_snapshot(self.path, TERM, "SRC-TT")

    @staticmethod
    def offering(snap, code):
        return [o for o in snap["offerings"] if o["code"] == code]

    @staticmethod
    def codes(report):
        return [i["code"] for i in report["issues"]]


class SlotMapTests(Base):
    def test_thirty_teaching_slots_and_lunch_excluded(self):
        snap, rep = self.build([])
        self.assertEqual(len(snap["slot_map"]), 30)
        self.assertNotIn("Lunch", json.dumps(snap["slot_map"]))
        self.assertEqual(rep["issues"], [])

    def test_documented_slot_times(self):
        snap, _ = self.build([])
        sm = snap["slot_map"]
        got = {k: (sm[k]["weekday"], sm[k]["start_minute"], sm[k]["end_minute"])
               for k in ("B1", "B2", "D1", "H2", "H1", "J2", "M2")}
        self.assertEqual(got, {
            "B1": (1, 510, 590), "B2": (4, 510, 590), "D1": (1, 600, 680),
            "H2": (2, 690, 770), "H1": (0, 1020, 1100),
            "J2": (4, 840, 920), "M2": (4, 930, 1010),
        })

    def test_missing_time_slots_sheet_is_reported_not_crashed(self):
        snap, rep = self.build([course_row("CS 101", "Intro", 4, "B1")], time_slots=False)
        self.assertIn("SHEET_MISSING", self.codes(rep))
        self.assertEqual(snap["slot_map"], {})
        g = self.offering(snap, "CS 101")[0]["meeting_groups"][0]
        self.assertEqual(g["selection_semantics"], "unknown")

    def test_end_before_start_is_an_issue(self):
        build_workbook(self.path, [])
        snap, rep = self.edit(lambda wb: wb["Time Slots"].__setitem__("A2", "09:50 - 08:30"))
        self.assertIn("SLOT_TIME_INVALID", self.codes(rep))
        self.assertNotIn("B1", snap["slot_map"])

    def test_conflicting_slot_definition(self):
        build_workbook(self.path, [])
        snap, rep = self.edit(lambda wb: wb["Time Slots"].__setitem__("C3", "B1"))
        self.assertIn("SLOT_DEFINITION_CONFLICT", self.codes(rep))

    def test_unrecognized_slot_sheet_layout_reported(self):
        build_workbook(self.path, [])
        snap, rep = self.edit(lambda wb: wb["Time Slots"].__setitem__("C1", "Someday"))
        self.assertIn("SLOT_SHEET_LAYOUT", self.codes(rep))


class CourseRowTests(Base):
    def test_credits_come_from_f_not_contact_hours(self):
        snap, _ = self.build([course_row("CS 437", "Lab course", 2, lab="K1", l=0, t=0, p=4)])
        self.assertEqual(self.offering(snap, "CS 437")[0]["credits"], "2")

    def test_decimal_credits_not_rounded(self):
        snap, _ = self.build([course_row("CS 101", "X", 1.5, "B1")])
        self.assertEqual(self.offering(snap, "CS 101")[0]["credits"], "1.5")

    def test_invalid_credit_is_issue_not_crash(self):
        snap, rep = self.build([course_row("CS 101", "X", "four", "B1"),
                                course_row("CS 102", "Y", 4, "B2")])
        self.assertIn("CREDITS_INVALID", self.codes(rep))
        self.assertIsNone(self.offering(snap, "CS 101")[0]["credits"])
        self.assertEqual(len(self.offering(snap, "CS 102")), 1)

    def test_code_spacing_normalized_and_suffix_preserved(self):
        snap, _ = self.build([
            course_row("CS202", "A", 4, "D1"),
            course_row("ES 242(N)", "B", 4, "B1"),
            course_row("HS 101 (E)", "C", 4, "B2"),
        ])
        self.assertEqual(self.offering(snap, "CS 202")[0]["display_code"], "CS 202")
        n = self.offering(snap, "ES 242")[0]
        self.assertEqual((n["display_code"], n["raw_label"]), ("ES 242(N)", "ES 242(N)"))
        self.assertEqual(self.offering(snap, "HS 101")[0]["display_code"], "HS 101 (E)")

    def test_n_variant_and_plain_course_are_not_merged(self):
        snap, _ = self.build([course_row("ES 242", "A", 3, "B1"),
                              course_row("ES 242(N)", "A", 4, "B1")])
        self.assertEqual(len(snap["offerings"]), 2)

    def test_blank_formatted_rows_create_no_offerings(self):
        snap, rep = self.build([course_row("CS 101", "X", 4, "B1")], blank_rows=1000)
        self.assertEqual(len(snap["offerings"]), 1)
        # Only the sheet-level note that columns O/Q are empty; no issue for any of the 1000 formatted rows.
        self.assertEqual([i for i in rep["issues"] if i["code"] != "SOURCE_COLUMN_EMPTY"], [])

    def test_section_rows_skipped_unrecognized_rows_reported(self):
        snap, rep = self.build([
            "Computer Science and Engineering - Year 3",
            course_row("CS 101", "X", 4, "B1"),
            {"A": "Guest lecture?", "B": "to be announced", "F": 2},
        ])
        self.assertEqual(len(snap["offerings"]), 1)
        self.assertEqual(rep["stats"]["section_rows"], 1)
        unrec = [i for i in rep["issues"] if i["code"] == "ROW_UNRECOGNIZED"]
        self.assertEqual(len(unrec), 1)
        self.assertEqual(unrec[0]["source_refs"][0]["locator"], "Time table!A5")

    def test_unsupported_header_structure_reported(self):
        build_workbook(self.path, [course_row("CS 101", "X", 4, "B1")])
        snap, rep = self.edit(lambda wb: wb["Time table"].__setitem__("F2", "Seats"))
        self.assertIn("HEADER_MISMATCH", self.codes(rep))
        self.assertEqual(snap["offerings"], [])

    def test_missing_time_table_sheet(self):
        build_workbook(self.path, [])
        snap, rep = self.edit(lambda wb: setattr(wb["Time table"], "title", "Renamed"))
        self.assertIn("SHEET_MISSING", self.codes(rep))
        self.assertEqual(snap["offerings"], [])

    def test_unreadable_file_returns_report(self):
        self.path.write_bytes(b"not a workbook")
        snap, rep = build_snapshot(self.path, TERM, "SRC-TT")
        self.assertIn("FILE_UNREADABLE", self.codes(rep))
        self.assertEqual(snap["offerings"], [])


class MeetingTests(Base):
    def test_lecture_and_tutorial_slots_resolved_through_slot_map(self):
        snap, _ = self.build([course_row("PH 202", "Physics", 4, "B1,B2", "H2")])
        groups = {g["kind"]: g for g in self.offering(snap, "PH 202")[0]["meeting_groups"]}
        lec = groups["lecture"]
        self.assertEqual(lec["selection_semantics"], "all_required")
        got = sorted((m["weekday"], m["start_minute"], m["end_minute"], m["original_slot"])
                     for m in lec["meetings"])
        self.assertEqual(got, [(1, 510, 590, "B1"), (4, 510, 590, "B2")])
        self.assertEqual(groups["tutorial"]["selection_semantics"], "all_required")
        self.assertEqual(groups["tutorial"]["meetings"][0]["weekday"], 2)

    def test_meetings_carry_cell_locators(self):
        snap, _ = self.build([course_row("PH 202", "P", 4, "B1", "H2")])
        groups = {g["kind"]: g for g in self.offering(snap, "PH 202")[0]["meeting_groups"]}
        self.assertEqual(groups["lecture"]["meetings"][0]["source_refs"][0]["locator"], "Time table!K3")
        self.assertEqual(groups["tutorial"]["meetings"][0]["source_refs"][0]["locator"], "Time table!L3")

    def group(self, snap, code, kind):
        return next(g for g in self.offering(snap, code)[0]["meeting_groups"] if g["kind"] == kind)

    def test_multiple_lab_slots_are_alternatives_one_per_student(self):
        # D-26 (Harsh, 7 Nov 2026): a lab that lists several slots assigns each student to exactly one of them.
        snap, rep = self.build([course_row("CS 202", "OS", 4, "D1", lab="J2,M2")])
        lab = self.group(snap, "CS 202", "lab")
        self.assertEqual(lab["selection_semantics"], "choose_one")
        self.assertEqual(sorted(m["original_slot"] for m in lab["meetings"]), ["J2", "M2"])
        self.assertNotIn("MEETING_SEMANTICS_UNKNOWN", self.codes(rep))

    def test_multiple_tutorial_slots_are_alternatives_one_per_student(self):
        snap, rep = self.build([course_row("PH 202", "Physics", 4, "B1", "H2,H1")])
        tutorial = self.group(snap, "PH 202", "tutorial")
        self.assertEqual(tutorial["selection_semantics"], "choose_one")
        self.assertEqual(len(tutorial["meetings"]), 2)
        self.assertNotIn("MEETING_SEMANTICS_UNKNOWN", self.codes(rep))

    def test_multiple_lecture_slots_stay_all_required(self):
        # A lecture's slots are its weekly meetings: B1 and B2 both happen (D-26 changes labs and tutorials only).
        snap, rep = self.build([course_row("PH 202", "Physics", 4, "B1,B2")])
        lecture = self.group(snap, "PH 202", "lecture")
        self.assertEqual(lecture["selection_semantics"], "all_required")
        self.assertEqual(len(lecture["meetings"]), 2)
        self.assertNotIn("MEETING_SEMANTICS_UNKNOWN", self.codes(rep))

    def test_unresolved_lab_stays_unknown_not_alternatives(self):
        # Z9 is not a slot in the legend, so the group is unresolved: never guessed as alternatives.
        snap, rep = self.build([course_row("CS 202", "OS", 4, "D1", lab="J2,Z9")])
        lab = self.group(snap, "CS 202", "lab")
        self.assertEqual(lab["selection_semantics"], "unknown")
        self.assertIn("SLOT_UNKNOWN", self.codes(rep))

    def test_single_slot_tutorial_stays_required(self):
        snap, _ = self.build([course_row("PH 202", "Physics", 4, "B1", "H2")])
        self.assertEqual(self.group(snap, "PH 202", "tutorial")["selection_semantics"], "all_required")

    def test_single_lab_slot_is_required(self):
        snap, _ = self.build([course_row("CS 330", "SW", 4, "B1", lab="H1")])
        lab = next(g for g in self.offering(snap, "CS 330")[0]["meeting_groups"] if g["kind"] == "lab")
        self.assertEqual(lab["selection_semantics"], "all_required")

    def test_unknown_slot_token_reported_and_kept_raw(self):
        snap, rep = self.build([course_row("CS 101", "X", 4, "B1,Z9")])
        self.assertIn("SLOT_UNKNOWN", self.codes(rep))
        g = self.offering(snap, "CS 101")[0]["meeting_groups"][0]
        self.assertEqual(g["raw_text"], "B1,Z9")
        self.assertEqual(len(g["meetings"]), 1)
        self.assertEqual(g["selection_semantics"], "unknown")

    def test_room_numbers_are_not_slots(self):
        snap, _ = self.build([course_row("CS 101", "X", 4, "B1 (Room 1/101)")])
        m = self.offering(snap, "CS 101")[0]["meeting_groups"][0]["meetings"]
        self.assertEqual([x["original_slot"] for x in m], ["B1"])
        self.assertEqual(m[0]["room"], "Room 1/101")

    def test_online_note_keeps_the_time_commitment(self):
        snap, _ = self.build([course_row("CS 101", "X", 4, "B1 Online")])
        m = self.offering(snap, "CS 101")[0]["meeting_groups"][0]["meetings"][0]
        self.assertEqual(m["start_minute"], 510)
        self.assertIsNone(m["room"])
        self.assertEqual(m["delivery_note"], "Online")

    def test_meeting_active_range_is_unknown(self):
        snap, _ = self.build([course_row("CS 101", "X", 4, "B1")])
        m = self.offering(snap, "CS 101")[0]["meeting_groups"][0]["meetings"][0]
        self.assertIsNone(m["active_start_date"])
        self.assertIsNone(m["active_end_date"])


class DuplicateTests(Base):
    def test_exact_duplicate_rows_merge_with_combined_provenance(self):
        row = course_row("CS 202", "OS", 4, "D1", lab="J2,M2")
        snap, rep = self.build([], place={27: row, 110: dict(row)})
        offs = self.offering(snap, "CS 202")
        self.assertEqual(len(offs), 1)
        locs = sorted(r["locator"] for r in offs[0]["source_refs"])
        self.assertEqual(locs, ["Time table!A110", "Time table!A27"])
        lec = next(g for g in offs[0]["meeting_groups"] if g["kind"] == "lecture")
        self.assertEqual(len(lec["meetings"]), 1)
        self.assertNotIn("DUPLICATE_CODE_CONFLICT", self.codes(rep))
        self.assertEqual(rep["stats"]["duplicate_labels"], 1)

    def test_conflicting_same_code_rows_both_retained_and_flagged(self):
        snap, rep = self.build([course_row("CS 329", "AI", 4, "B1,B2"),
                                course_row("CS 329", "AI", 2, "H2")])
        self.assertEqual(len(self.offering(snap, "CS 329")), 2)
        self.assertEqual(len({o["id"] for o in snap["offerings"]}), 2)
        self.assertIn("DUPLICATE_CODE_CONFLICT", self.codes(rep))

    def test_triplicate_rows_still_one_offering(self):
        row = course_row("CS 202", "OS", 4, "D1")
        snap, _ = self.build([row, dict(row), dict(row)])
        self.assertEqual(len(snap["offerings"]), 1)
        self.assertEqual(len(snap["offerings"][0]["source_refs"]), 3)


class MetadataTests(Base):
    def test_empty_preferred_knowledge_and_minor_are_unavailable_not_none(self):
        snap, _ = self.build([course_row("CS 101", "X", 4, "B1")])
        o = self.offering(snap, "CS 101")[0]
        self.assertEqual(o["prerequisites_status"], "unknown")
        self.assertIsNone(o["preferred_knowledge"])
        self.assertIsNone(o["minor_hint"])

    def test_nonempty_preferred_knowledge_never_becomes_a_prerequisite(self):
        snap, _ = self.build([course_row("CS 101", "X", 4, "B1", pref="CS 100", minor="AI")])
        o = self.offering(snap, "CS 101")[0]
        self.assertEqual((o["preferred_knowledge"], o["minor_hint"]), ("CS 100", "AI"))
        self.assertEqual(o["prerequisites_status"], "unknown")
        self.assertNotIn("prerequisites", o)

    def test_hyperlink_target_extracted_not_fetched(self):
        build_workbook(self.path, [course_row("CS 330", "SW", 4, "B1", link="CS301:OS")])
        snap, _ = self.edit(lambda wb: setattr(wb["Time table"]["N3"], "hyperlink",
                                               "https://example.invalid/plan"))
        link = self.offering(snap, "CS 330")[0]["course_plan_link"]
        self.assertEqual(link["target"], "https://example.invalid/plan")
        self.assertEqual(link["display_text"], "CS301:OS")
        self.assertEqual(link["locator"], "Time table!N3")
        self.assertEqual([o["code"] for o in snap["offerings"]], ["CS 330"])

    def test_classification_tags_are_candidates(self):
        snap, _ = self.build([course_row("PH 202", "P", 4, "B1", tag="BS")])
        o = self.offering(snap, "PH 202")[0]
        self.assertEqual(o["classification_tag_candidates"], ["BS"])
        self.assertNotIn("classification", o)


class SnapshotContractTests(Base):
    def test_snapshot_is_term_specific_unreviewed_and_incomplete(self):
        snap, _ = self.build([course_row("CS 101", "X", 4, "B1")])
        self.assertEqual(snap["term_id"], TERM)
        self.assertEqual(snap["coverage"], "unknown")
        self.assertEqual(snap["review_status"], "draft")
        self.assertIsNone(snap["revision_date"])
        self.assertEqual(snap["offerings"][0]["availability_status"], "confirmed_in_snapshot")

    def test_source_hash_recorded_and_no_absolute_path(self):
        snap, rep = self.build([course_row("CS 101", "X", 4, "B1")])
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.assertEqual(snap["source_refs"][0]["file_sha256"], digest)
        self.assertNotIn(self._tmp.name, json.dumps(snap) + json.dumps(rep))

    def test_source_file_not_modified(self):
        build_workbook(self.path, [course_row("CS 101", "X", 4, "B1")])
        before = (self.path.read_bytes(), os.stat(self.path).st_mtime_ns)
        build_snapshot(self.path, TERM, "SRC-TT")
        self.assertEqual(before, (self.path.read_bytes(), os.stat(self.path).st_mtime_ns))

    def test_output_deterministic_and_sorted(self):
        build_workbook(self.path, [course_row("CS 101", "X", 4, "B1"),
                                   course_row("CS 100", "Y", 4, "H2")])
        a = build_snapshot(self.path, TERM, "SRC-TT")
        b = build_snapshot(self.path, TERM, "SRC-TT")
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        self.assertEqual([o["code"] for o in a[0]["offerings"]], ["CS 100", "CS 101"])

    def test_bad_term_id_rejected(self):
        build_workbook(self.path, [])
        with self.assertRaises(ValueError):
            build_snapshot(self.path, "2026-27", "SRC-TT")

    def test_one_bad_row_does_not_stop_others(self):
        snap, _ = self.build([course_row("CS 101", "X", None, "B1"),
                              course_row("CS 102", "Y", 4, "B2")])
        self.assertEqual(len(snap["offerings"]), 2)

    def test_stats_diagnostics(self):
        _, rep = self.build([course_row("CS 101", "X", 4, "B1"), course_row("CS 101", "X", 4, "B1"),
                             course_row("CS 102", "Y", 4, "B2")])
        self.assertEqual(rep["stats"]["course_pattern_rows"], 3)
        self.assertEqual(rep["stats"]["distinct_labels"], 2)


class AvailabilityTests(Base):
    def test_availability_never_adds_offerings_and_flags_mismatch(self):
        build_workbook(self.path, [course_row("CS 101", "X", 4, "B1")])

        def fill(wb):
            av = wb["Availability"]
            av["A2"], av["B2"], av["C2"] = "CS 101", "B2", "Room 5"
            av["A3"], av["B3"], av["C3"] = "CS 999", "B1", "Room 6"

        snap, rep = self.edit(fill)
        self.assertEqual([o["code"] for o in snap["offerings"]], ["CS 101"])
        self.assertEqual(self.codes(rep).count("AVAILABILITY_MISMATCH"), 2)
        m = self.offering(snap, "CS 101")[0]["meeting_groups"][0]["meetings"][0]
        self.assertEqual(m["original_slot"], "B1")

    def test_consistent_availability_row_is_silent(self):
        build_workbook(self.path, [course_row("CS 101", "X", 4, "B1")])
        snap, rep = self.edit(lambda wb: [wb["Availability"].__setitem__("A2", "CS 101"),
                                          wb["Availability"].__setitem__("B2", "B1")])
        self.assertNotIn("AVAILABILITY_MISMATCH", self.codes(rep))


class CliTests(Base):
    def run_cli(self, input_path=None):
        out, rep = Path(self._tmp.name) / "o.json", Path(self._tmp.name) / "r.json"
        p = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "build_timetable.py"),
             "--input", str(input_path or self.path), "--term", TERM,
             "--output", str(out), "--report", str(rep)],
            capture_output=True, text=True, cwd=ROOT)
        return p, out, rep

    def test_cli_writes_sorted_json_and_report(self):
        build_workbook(self.path, [course_row("CS 101", "X", 4, "B1")])
        p, out, rep = self.run_cli()
        self.assertEqual(p.returncode, 0, p.stderr)
        snap = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(snap["offerings"][0]["code"], "CS 101")
        self.assertEqual(snap["source_refs"][0]["id"], "SRC-TIMETABLE")
        self.assertIn("issues", json.loads(rep.read_text(encoding="utf-8")))

    def test_cli_exits_nonzero_on_error_issues_but_still_writes(self):
        build_workbook(self.path, [], time_slots=False)
        p, out, rep = self.run_cli()
        self.assertEqual(p.returncode, 2)
        self.assertTrue(out.exists() and rep.exists())

    def test_cli_missing_input_writes_nothing(self):
        p, out, _ = self.run_cli(Path(self._tmp.name) / "absent.xlsx")
        self.assertEqual(p.returncode, 1)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
