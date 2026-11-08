"""Adapter cases in the supplied workbook's own formats (M02).

The first synthetic workbooks assumed "Monday" headers and one slot per cell;
the supplied file uses "Slot, M, T, W, Th, F", multi-line meeting cells with
room pools, and a slot-by-room Availability grid. These cases use those formats.
"""
import unittest

from tests.data_sources.test_timetable_xlsx import Base
from tests.data_sources.workbook_factory import SUPPLIED_WEEKDAYS, course_row


def groups(snap, code):
    offering = next(o for o in snap["offerings"] if o["code"] == code)
    return {g["kind"]: g for g in offering["meeting_groups"]}


class SuppliedSlotHeaderTests(Base):
    def test_abbreviated_weekday_header_resolves_every_slot(self):
        snap, rep = self.build([course_row("CS 101", "X", 4, "B1")], weekdays=SUPPLIED_WEEKDAYS)
        self.assertNotIn("SLOT_SHEET_LAYOUT", self.codes(rep))
        self.assertEqual(len(snap["slot_map"]), 30)
        self.assertEqual(snap["slot_map"]["B1"]["weekday"], 1)  # T = Tuesday
        self.assertEqual(snap["slot_map"]["H1"]["weekday"], 0)  # M = Monday
        thursday = {s["weekday"] for k, s in snap["slot_map"].items() if s["locator"].endswith(("E2", "E3", "E4"))}
        self.assertEqual(thursday, {3})  # Th = Thursday, not Tuesday


class SuppliedMeetingCellTests(Base):
    def build_supplied(self, rows):
        return self.build(rows, weekdays=SUPPLIED_WEEKDAYS)

    def test_slot_line_then_shared_room_pool(self):
        snap, rep = self.build_supplied([course_row("PH 202", "Physics", 4, "B1,B2\n(7/206)", "H2\n(13/125,11/204)")])
        g = groups(snap, "PH 202")
        self.assertEqual(g["lecture"]["selection_semantics"], "all_required")
        self.assertEqual(sorted(m["original_slot"] for m in g["lecture"]["meetings"]), ["B1", "B2"])
        self.assertEqual({m["room"] for m in g["lecture"]["meetings"]}, {"7/206"})
        tut = g["tutorial"]
        self.assertEqual(tut["selection_semantics"], "all_required")
        self.assertEqual([m["original_slot"] for m in tut["meetings"]], ["H2"])
        # Two rooms for one slot: which room is not stated, so no single room is invented.
        self.assertIsNone(tut["meetings"][0]["room"])
        self.assertEqual(tut["meetings"][0]["room_options"], ["13/125", "11/204"])
        self.assertNotIn("MEETING_TEXT_UNPARSED", self.codes(rep))

    def test_one_line_per_slot_keeps_every_slot_and_its_rooms(self):
        lab = "J2 (10/103,10/104)\nP1 (10/104,Jagdish Patel Learning Theatre)"
        snap, rep = self.build_supplied([course_row("ES 112", "Computing", 3, "D1,D2\n(Jasubhai Auditorium)", lab=lab)])
        meetings = {m["original_slot"]: m for m in groups(snap, "ES 112")["lab"]["meetings"]}
        self.assertEqual(sorted(meetings), ["J2", "P1"])
        self.assertEqual(meetings["J2"]["room_options"], ["10/103", "10/104"])
        self.assertEqual(meetings["P1"]["room_options"], ["10/104", "Jagdish Patel Learning Theatre"])
        self.assertEqual(groups(snap, "ES 112")["lab"]["selection_semantics"], "choose_one")  # J2 and P1: one per student (D-26)
        self.assertNotIn("MEETING_TEXT_UNPARSED", self.codes(rep))

    def test_room_pool_on_a_single_line_lab(self):
        snap, _ = self.build_supplied([course_row("CS 330", "SW", 4, "E1,E2\n(Harsha Patel Learning Theatre)", lab="H1\n(10/203,10/204)")])
        lab = groups(snap, "CS 330")["lab"]
        self.assertEqual(lab["selection_semantics"], "all_required")
        self.assertEqual([m["original_slot"] for m in lab["meetings"]], ["H1"])

    def test_genuinely_unreadable_text_is_still_reported(self):
        snap, rep = self.build_supplied([course_row("CS 101", "X", 4, "B1\nto be announced")])
        self.assertIn("MEETING_TEXT_UNPARSED", self.codes(rep))
        self.assertEqual(groups(snap, "CS 101")["lecture"]["selection_semantics"], "unknown")

    def test_online_line_is_a_delivery_note_not_a_room(self):
        snap, _ = self.build_supplied([course_row("CS 101", "X", 4, "B1\n(Online)")])
        m = groups(snap, "CS 101")["lecture"]["meetings"][0]
        self.assertEqual((m["room"], m["delivery_note"], m["start_minute"]), (None, "Online", 510))


class ContractFieldTests(Base):
    def test_offering_group_and_meeting_carry_contract_ids(self):
        snap, _ = self.build([course_row("PH 202", "Physics", 4, "B1,B2", sections="Section 1\nSection 2")],
                             weekdays=SUPPLIED_WEEKDAYS)
        o = snap["offerings"][0]
        self.assertEqual(o["term_id"], "2026-27-I")
        self.assertEqual(o["section_labels"], ["Section 1", "Section 2"])
        g = o["meeting_groups"][0]
        self.assertEqual(g["section_labels"], [])  # the sheet does not tie sections to meeting groups
        for m in g["meetings"]:
            self.assertEqual((m["offering_id"], m["group_id"]), (o["id"], g["id"]))


class MetadataGapTests(Base):
    def test_empty_preferred_knowledge_and_minor_columns_are_reported_unavailable(self):
        snap, rep = self.build([course_row("CS 101", "X", 4, "B1"), course_row("CS 102", "Y", 4, "B2")])
        gaps = {i["code"]: i for i in rep["issues"] if i["code"] == "SOURCE_COLUMN_EMPTY"}
        self.assertTrue(gaps)
        messages = " ".join(i["message"] for i in rep["issues"] if i["code"] == "SOURCE_COLUMN_EMPTY")
        self.assertIn("preferred knowledge", messages.lower())
        self.assertIn("minor", messages.lower())
        self.assertTrue(all(o["prerequisites_status"] == "unknown" for o in snap["offerings"]))

    def test_rows_differing_only_in_remarks_are_not_merged(self):
        snap, rep = self.build([course_row("CS 101", "X", 4, "B1", remarks="Section A only"),
                                course_row("CS 101", "X", 4, "B1", remarks="Section B only")])
        offerings = [o for o in snap["offerings"] if o["code"] == "CS 101"]
        self.assertEqual(sorted(o["remarks"] for o in offerings), ["Section A only", "Section B only"])
        self.assertIn("DUPLICATE_CODE_CONFLICT", self.codes(rep))


class SuppliedAvailabilityTests(Base):
    def fill(self, cells):
        def apply(wb):
            av = wb["Availability"]
            av["A1"], av["B1"], av["C1"] = "Time Slot", "7/206", "13/125"
            av["A2"], av["B2"], av["C2"] = "Capacity", 40, 20
            for coord, value in cells.items():
                av[coord] = value
        return self.edit(apply)

    def test_slot_by_room_grid_checks_every_listed_course(self):
        self.build([course_row("PH 202", "Physics", 4, "B1,B2\n(7/206)"), course_row("CS 331", "Net", 4, "G1")],
                   weekdays=SUPPLIED_WEEKDAYS)
        snap, rep = self.fill({"A3": "B1", "B3": "PH 202", "C3": "CS 331", "A4": "B2", "B4": "PH 202"})
        mismatches = [i for i in rep["issues"] if i["code"] == "AVAILABILITY_MISMATCH"]
        self.assertEqual(len(mismatches), 1)
        self.assertIn("CS 331", mismatches[0]["message"])
        self.assertIn("B1", mismatches[0]["message"])
        self.assertEqual(sorted(o["code"] for o in snap["offerings"]), ["CS 331", "PH 202"])

    def test_consistent_grid_is_silent(self):
        self.build([course_row("PH 202", "Physics", 4, "B1,B2\n(7/206)")], weekdays=SUPPLIED_WEEKDAYS)
        _, rep = self.fill({"A3": "B1", "B3": "PH 202", "A4": "B2", "B4": "PH 202"})
        self.assertNotIn("AVAILABILITY_MISMATCH", self.codes(rep))


if __name__ == "__main__":
    unittest.main()
