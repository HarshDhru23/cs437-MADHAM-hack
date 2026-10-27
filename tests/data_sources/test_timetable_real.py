"""Opt-in check of the adapter on the supplied timetable workbook (M02 "actual source inspection controls").

The workbook is git-ignored. Point COURSEPATH_TIMETABLE_XLSX at it, or keep it at the repository root
(or in COURSEPATH_REAL_INPUT_DIR) under its supplied name. Expected values are the documented controls in
tests/reference_fixtures/expected_timetable_controls.json, not adapter output. Skipped, visibly, without it.
"""
import hashlib
import json
import os
import unittest
from pathlib import Path

from coursepath.data_sources.timetable_xlsx import build_snapshot

ROOT = Path(__file__).resolve().parents[2]
NAME = "Timetable, Sem-I, 2026-27.xlsx"
CONTROLS = json.loads((ROOT / "tests" / "reference_fixtures" / "expected_timetable_controls.json").read_text(encoding="utf-8"))


def _workbook():
    candidates = [os.environ.get("COURSEPATH_TIMETABLE_XLSX"),
                  os.environ.get("COURSEPATH_REAL_INPUT_DIR") and str(Path(os.environ["COURSEPATH_REAL_INPUT_DIR"]) / NAME),
                  str(ROOT / NAME)]
    return next((Path(c) for c in candidates if c and Path(c).is_file()), None)


WORKBOOK = _workbook()


@unittest.skipUnless(WORKBOOK, f"supplied timetable workbook not found (set COURSEPATH_TIMETABLE_XLSX or place '{NAME}' at the repository root)")
class SuppliedWorkbookControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.digest_before = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
        cls.snap, cls.report = build_snapshot(WORKBOOK, "2026-27-I", "SRC-TIMETABLE")
        cls.by_code = {}
        for o in cls.snap["offerings"]:
            cls.by_code.setdefault(o["code"], []).append(o)

    def groups(self, code):
        offerings = self.by_code[code]
        self.assertEqual(len(offerings), 1, f"{code} should be one offering")
        return {g["kind"]: g for g in offerings[0]["meeting_groups"]}

    def test_source_is_not_modified(self):
        self.assertEqual(hashlib.sha256(WORKBOOK.read_bytes()).hexdigest(), self.digest_before)

    def test_no_ingestion_errors(self):
        self.assertEqual([i for i in self.report["issues"] if i["severity"] == "error"], [])

    def test_row_diagnostics(self):
        d = CONTROLS["diagnostic_only"]
        stats = self.report["stats"]
        self.assertEqual((stats["course_pattern_rows"], stats["distinct_labels"], stats["duplicate_labels"]),
                         (d["course_pattern_rows"], d["distinct_literal_labels"], d["labels_occurring_more_than_once"]))

    def test_slot_legend(self):
        slots = self.snap["slot_map"]
        self.assertEqual(len(slots), CONTROLS["teaching_slots"])
        for token, expected in CONTROLS["slots"].items():
            with self.subTest(slot=token):
                got = slots[token]
                self.assertEqual((got["weekday"], got["start_minute"], got["end_minute"]),
                                 (expected["weekday"], expected["start_minute"], expected["end_minute"]))

    def test_documented_rows(self):
        for code, expected in CONTROLS["rows"].items():
            with self.subTest(code=code):
                offering = self.by_code[code][0]
                self.assertEqual(len(self.by_code[code]), 1)
                self.assertEqual(offering["credits"], expected["credits"])
                rows = sorted(int(r["locator"].rsplit("A", 1)[1]) for r in offering["source_refs"])
                self.assertEqual(rows, expected["rows"])
                g = {grp["kind"]: grp for grp in offering["meeting_groups"]}
                for kind in ("lecture", "tutorial", "lab"):
                    if kind in expected:
                        self.assertEqual(sorted(m["original_slot"] for m in g[kind]["meetings"]),
                                         sorted(expected[kind].split(",")), kind)
                        self.assertEqual(g[kind]["unresolved"], [], kind)

    def test_documented_overlaps(self):
        for pair, overlaps in CONTROLS["expected_overlaps"].items():
            a, b = pair.split(" vs ")
            for o in overlaps:
                with self.subTest(pair=pair, slots=o["slots"]):
                    for code, slot in zip((a, b), o["slots"]):
                        meeting = next(m for m in self.groups(code)[o["kind"]]["meetings"] if m["original_slot"] == slot)
                        self.assertEqual((meeting["weekday"], meeting["start_minute"], meeting["end_minute"]),
                                         (o["weekday"], o["start_minute"], o["end_minute"]))

    def test_selection_semantics_of_documented_groups(self):
        self.assertEqual(self.groups("PH 202")["lecture"]["selection_semantics"], "all_required")
        self.assertEqual(self.groups("PH 202")["tutorial"]["selection_semantics"], "all_required")
        self.assertEqual(self.groups("CS 330")["lab"]["selection_semantics"], "all_required")
        self.assertEqual(self.groups("CS 202")["lab"]["selection_semantics"], "unknown")  # J2,M2: alternatives not stated


if __name__ == "__main__":
    unittest.main()
