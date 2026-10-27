"""Timetable regression oracle: documented source cells -> adapter -> expected overlaps.

The workbook is rebuilt synthetically with the documented rows/slot cells at their
documented row numbers. Overlap math here is independent of any domain engine."""
import json
import tempfile
import unittest
from itertools import combinations
from pathlib import Path

from coursepath.data_sources.timetable_xlsx import build_snapshot
from tests.data_sources.workbook_factory import build_workbook, course_row

FIX = Path(__file__).resolve().parents[1] / "reference_fixtures"
CONTROLS = json.loads((FIX / "expected_timetable_controls.json").read_text(encoding="utf-8"))


def documented_rows():
    place = {}
    for code, spec in CONTROLS["rows"].items():
        for r in spec["rows"]:
            place[r] = course_row(code, f"{code} title", spec["credits"], spec.get("lecture", ""),
                                  spec.get("tutorial", ""), spec.get("lab", ""))
    return place


def overlaps(a, b):
    """Required-meeting overlaps between two offerings as (kind, weekday, start, end)."""
    out = []
    for ga in a["meeting_groups"]:
        for gb in b["meeting_groups"]:
            if ga["kind"] != gb["kind"] or "unknown" in (ga["selection_semantics"], gb["selection_semantics"]):
                continue
            for ma in ga["meetings"]:
                for mb in gb["meetings"]:
                    if ma["weekday"] == mb["weekday"] and ma["start_minute"] < mb["end_minute"] \
                            and mb["start_minute"] < ma["end_minute"]:
                        out.append((ga["kind"], ma["weekday"], max(ma["start_minute"], mb["start_minute"]),
                                    min(ma["end_minute"], mb["end_minute"])))
    return sorted(out)


class SampleReconciliationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        path = Path(cls._tmp.name) / "tt.xlsx"
        build_workbook(path, [], place=documented_rows())
        cls.snap, cls.report = build_snapshot(path, "2026-27-I", "SRC-TIMETABLE")
        cls.by = {o["code"]: o for o in cls.snap["offerings"]}

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def expected(self, key):
        return sorted((e["kind"], e["weekday"], e["start_minute"], e["end_minute"])
                      for e in CONTROLS["expected_overlaps"][key])

    def test_ph202_es667_lecture_overlaps(self):
        self.assertEqual(overlaps(self.by["PH 202"], self.by["ES 667"]), self.expected("PH 202 vs ES 667"))

    def test_ph202_cs331_tutorial_overlap_only(self):
        self.assertEqual(overlaps(self.by["PH 202"], self.by["CS 331"]), self.expected("PH 202 vs CS 331"))

    def test_overlap_is_found_despite_no_room_data(self):
        for o in (self.by["PH 202"], self.by["ES 667"]):
            self.assertTrue(all(m["room"] is None for g in o["meeting_groups"] for m in g["meetings"]))

    def test_repeated_cs202_and_cs329_rows_do_not_double(self):
        for code in ("CS 202", "CS 329"):
            offs = [o for o in self.snap["offerings"] if o["code"] == code]
            self.assertEqual(len(offs), 1, code)
            self.assertEqual(len(offs[0]["source_refs"]), 2, code)
        self.assertEqual([r["locator"] for r in self.by["CS 202"]["source_refs"]],
                         ["Time table!A27", "Time table!A110"])

    def test_cs202_and_cs203_remain_separate(self):
        self.assertIn("CS 203", self.by)
        self.assertNotEqual(self.by["CS 202"]["id"], self.by["CS 203"]["id"])
        self.assertNotIn("CS 301", self.by)

    def test_credits_come_from_documented_f_column(self):
        for code, spec in CONTROLS["rows"].items():
            self.assertEqual(self.by[code]["credits"], spec["credits"], code)

    def test_cs202_lab_alternatives_stay_unknown(self):
        lab = next(g for g in self.by["CS 202"]["meeting_groups"] if g["kind"] == "lab")
        self.assertEqual(lab["selection_semantics"], "unknown")
        self.assertEqual(sorted(m["original_slot"] for m in lab["meetings"]), ["J2", "M2"])

    def test_documented_slot_times_match_controls(self):
        for token, exp in CONTROLS["slots"].items():
            got = self.snap["slot_map"][token]
            self.assertEqual({k: got[k] for k in exp}, exp, token)
        self.assertEqual(len(self.snap["slot_map"]), CONTROLS["teaching_slots"])

    def test_cs437_credits_two_not_contact_hours(self):
        self.assertEqual(self.by["CS 437"]["credits"], "2")

    def test_no_future_term_inherits_slots(self):
        self.assertEqual(self.snap["term_id"], "2026-27-I")
        self.assertTrue(all(o["term_id"] if "term_id" in o else True for o in self.snap["offerings"]))
        self.assertTrue(all(o["availability_status"] == "confirmed_in_snapshot" for o in self.snap["offerings"]))
        self.assertEqual(self.snap["coverage"], "unknown")


if __name__ == "__main__":
    unittest.main()
