"""M03/M05 cases run against Harsh's public services with independently derived expectations.

Scope is the 27 Oct slice (imports, performance, audit shell, plan workload).
Clash/internship/scenario cases wait for those services (H11-H14)."""
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from coursepath.degree_audit import evaluate_audit
from coursepath.imports.ims import parse_ims
from coursepath.imports.reconcile import reconcile_import
from coursepath.semester_plan import validate_plan
from coursepath.data_sources.timetable_xlsx import build_snapshot
from tests.data_sources.workbook_factory import build_workbook, course_row
from tests.reference.test_import_oracle import ims_text, oracle_rows

ROOT = Path(__file__).resolve().parents[2]
PLAN = json.loads((ROOT / "tests" / "reference_fixtures" / "expected_example_plan.json").read_text(encoding="utf-8"))
CURRICULUM = json.loads((ROOT / "data" / "curricula" / "cse-2024.json").read_text(encoding="utf-8"))


def example_plan():
    terms = {5: "2026-27-I", 6: "2026-27-II"}
    semesters = []
    for sem in PLAN["semesters"]:
        courses, placeholders = [], []
        for i, item in enumerate(sem["items"]):
            if "placeholder" in item:
                placeholders.append({"id": f"ph{sem['semester']}-{i}", "desired_credits": item["credits"], "label": item["placeholder"]})
            else:
                courses.append({"id": f"c{sem['semester']}-{i}", "normalized_code": item["code"], "credits": item["credits"]})
        semesters.append({"term_id": terms[sem["semester"]], "courses": courses, "placeholders": placeholders})
    return {"semesters": semesters}


class ExamplePlanThroughServices(unittest.TestCase):
    def setUp(self):
        self.result = validate_plan({"standing": "normal"}, example_plan())

    def test_workload_matches_independent_sums(self):
        w = self.result["workload"]
        self.assertEqual({k: (v["selected_credits"], v["placeholder_credits"], v["target_credits"]) for k, v in w.items()},
                         {"2026-27-I": ("28", "0", "28"), "2026-27-II": ("12", "12", "24")})

    def test_placeholders_unresolved_and_never_eligible(self):
        codes = [i["code"] for i in self.result["issues"]]
        self.assertIn("PLACEHOLDER_UNRESOLVED", codes)
        ph_ids = {p["id"] for s in example_plan()["semesters"] for p in s["placeholders"]}
        flagged = {e for i in self.result["issues"] if i["code"] == "PLACEHOLDER_UNRESOLVED" for e in i["entity_refs"]}
        self.assertEqual(flagged, ph_ids)
        self.assertNotIn("XX XXX", [c["id"] for c in self.result["per_course"]])

    def test_28_credits_is_not_a_load_violation_and_internship_is_not_in_the_plan(self):
        self.assertNotIn("LOAD_LIMIT", [i["code"] for i in self.result["issues"]])
        self.assertEqual(sum(Decimal(v["target_credits"]) for v in self.result["workload"].values()), Decimal(52))

    def test_unknown_standing_is_reported_not_assumed(self):
        codes = [i["code"] for i in validate_plan({}, example_plan())["issues"]]
        self.assertIn("STANDING_UNKNOWN", codes)

    def test_meetings_never_reported_clear_even_when_a_snapshot_is_supplied(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tt.xlsx"
            build_workbook(path, [course_row("PH 202", "P", 4, "B1,B2", "H2"), course_row("ES 667", "E", 4, "B1,B2")])
            snapshot, _ = build_snapshot(path, "2026-27-I", "SRC-TIMETABLE")
        result = validate_plan({"standing": "normal"}, example_plan(), snapshot)
        self.assertNotEqual(result["meeting_check_status"], "clear")
        self.assertTrue(all(c["meeting_check_status"] != "clear" for c in result["per_course"]))


class SampleRecordThroughAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        preview = parse_ims(ims_text(oracle_rows(True)), "synthetic-ims")
        record = reconcile_import({"attempts": [], "revision": 0}, preview, {})["record"]
        for a in record["attempts"]:
            a["learning_designation"] = "degree"
        cls.record, cls.preview = record, preview
        cls.audit = evaluate_audit(CURRICULUM, {}, record)

    def test_draft_curriculum_never_certifies_the_sample_record(self):
        self.assertFalse(self.audit["complete"])
        self.assertTrue(all(r["status"] != "satisfied" for r in self.audit["actual"]))

    def test_counted_credits_never_exceed_earned_credits_and_nothing_is_counted_twice(self):
        counted = sum(Decimal(a["credits"]) for a in self.audit["ledger"])
        earned = sum(Decimal(a["credits"]) for a in self.record["attempts"] if a["completion_status"] == "completed")
        self.assertEqual(earned, Decimal(105))
        self.assertLessEqual(counted, earned)
        ids = [a["attempt_id"] for a in self.audit["ledger"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_cs203_stays_flagged_and_is_not_renamed_cs202(self):
        cs203 = next(a for a in self.preview["candidate_attempts"] if a["normalized_code"] == "CS 203")
        flagged = [i for i in self.preview["issues"] if i["code"] == "EQUIVALENCE_UNCONFIRMED" and cs203["id"] in i["entity_refs"]]
        self.assertEqual(len(flagged), 1)
        self.assertNotIn("CS 202", [a["normalized_code"] for a in self.record["attempts"]])

    def test_sc372_is_unmatched_not_dropped_or_graduation_counted_by_credit_value(self):
        sc = next(a for a in self.record["attempts"] if a["normalized_code"] == "SC 372")
        self.assertEqual((sc["credits"], sc["grade"]), ("1", "P"))
        self.assertIn(sc["id"], [e for i in self.preview["issues"] if i["code"] == "UNMATCHED_COURSE" for e in i["entity_refs"]])

    def test_audit_is_deterministic_under_row_order(self):
        reversed_record = {**self.record, "attempts": list(reversed(self.record["attempts"]))}
        self.assertEqual(self.audit["ledger"], evaluate_audit(CURRICULUM, {}, reversed_record)["ledger"])


if __name__ == "__main__":
    unittest.main()
