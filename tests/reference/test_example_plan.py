"""Independent arithmetic oracle for the example graduation plan and sample controls.

Totals are recomputed here from the documented items; nothing is read from
Harsh's engine. Pending: run the same cases against the public domain services
once they are merged (docs/data/data-gaps.md GAP-08)."""
import json
import re
import unittest
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

FIX = Path(__file__).resolve().parents[1] / "reference_fixtures"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def total(items):
    return sum((Decimal(i["credits"]) for i in items), Decimal(0))


class ExamplePlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = load("expected_example_plan.json")
        cls.sems = {s["semester"]: s["items"] for s in cls.plan["semesters"]}

    def test_semester_totals_recomputed(self):
        self.assertEqual(total(self.sems[5]), Decimal("28"))
        self.assertEqual(total(self.sems[6]), Decimal("24"))
        self.assertEqual(len(self.sems[5]), 7)
        self.assertEqual(len(self.sems[6]), 6)

    def test_internship_is_proposal_only_sixteen_credits(self):
        i = self.plan["internship_proposal"]
        proposed = sum(Decimal(v) for v in i["proposed_credits"].values())
        self.assertEqual(i["proposed_credits"], {"open_elective": "12", "hss": "4"})
        self.assertEqual(proposed, Decimal("16"))
        self.assertEqual(Decimal(i["approved_credits"]), 0)
        self.assertIsNone(i["dates"])
        self.assertIsNone(i["approval_evidence"])

    def test_surplus_is_two_and_is_not_a_validity_verdict(self):
        planned = total(self.sems[5]) + total(self.sems[6]) + Decimal("16")
        self.assertEqual(planned, Decimal(self.plan["reported"]["planned_total"]))
        remaining = Decimal(self.plan["reported"]["remaining"])
        self.assertEqual(planned - remaining, Decimal(self.plan["expected"]["surplus_over_reported_remaining"]))
        completed, required = Decimal(self.plan["reported"]["completed"]), Decimal(self.plan["reported"]["required"])
        self.assertEqual(required - completed, remaining)
        self.assertNotIn("valid", json.dumps(self.plan["expected"]))

    def test_placeholders_are_never_real_courses(self):
        ph = [i for items in self.sems.values() for i in items if "placeholder" in i]
        self.assertEqual(len(ph), 3)
        self.assertTrue(all(i["code"] == "XX XXX" for i in ph))
        real = [i["code"] for items in self.sems.values() for i in items if "placeholder" not in i]
        self.assertNotIn("XX XXX", real)

    def test_cs421_and_cs431_stay_distinct_and_cs202_is_planned(self):
        codes = [i["code"] for items in self.sems.values() for i in items]
        self.assertIn("CS 421", codes)
        self.assertNotIn("CS 431", codes)
        self.assertIn("CS 202", codes)

    def test_historical_and_current_es112_credits_differ(self):
        es = self.plan["ambiguity_cases"]["es112_credits"]
        self.assertEqual((es["historical_attempt"], es["current_offering"]), ("3", "4"))


class ImportControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = load("expected_import_controls.json")

    def test_transcript_controls_are_internally_consistent(self):
        t = self.c["transcript"]
        self.assertEqual(sum(t["rows_per_term"]), t["attempts"])
        self.assertEqual(t["attempts"], 39)
        self.assertEqual(sum(Decimal(x) for x in t["credits_per_term"]), Decimal(t["reported_earned_credits"]))

    def test_ims_differs_by_exactly_sc372(self):
        t, i = self.c["transcript"], self.c["ims"]
        self.assertEqual(sum(Decimal(x) for x in i["credits_per_term"]), Decimal(i["raw_credits"]))
        self.assertEqual(Decimal(i["raw_credits"]) - Decimal(t["reported_earned_credits"]),
                         Decimal(i["extra_vs_transcript"]["credits"]))
        self.assertEqual(i["attempts"] - t["attempts"], 1)
        diffs = [a != b for a, b in zip(t["credits_per_term"], i["credits_per_term"])]
        self.assertEqual(diffs, [False, True, False, False])
        self.assertEqual(Decimal(i["credits_per_term"][1]) - Decimal(t["credits_per_term"][1]), 1)

    def test_cpi_reproduces_to_two_places(self):
        t = self.c["transcript"]
        cpi = Decimal(t["grade_points_total"]) / Decimal(t["performance_credits"])
        self.assertEqual(cpi.quantize(Decimal("0.01"), ROUND_HALF_UP), Decimal(t["cpi_display"]))
        self.assertLessEqual(cpi, Decimal(t["cpi_scale_max"]))
        # performance credits are fewer than earned credits because P/zero-credit rows are excluded
        self.assertLess(Decimal(t["performance_credits"]), Decimal(t["reported_earned_credits"]))

    def test_grade_points_p_has_no_value_and_d_is_pass_floor(self):
        g = self.c["grade_points"]
        self.assertNotIn("P", g)
        self.assertEqual(g["D"], 4)
        self.assertEqual(max(g.values()), 11)


class FixtureHygieneTests(unittest.TestCase):
    def test_no_roll_numbers_emails_or_names_in_fixtures(self):
        for f in FIX.glob("*.json"):
            text = f.read_text(encoding="utf-8")
            self.assertIsNone(re.search(r"\b2\d{7}\b", text), f.name)
            self.assertIsNone(re.search(r"@\w+\.", text), f.name)
            self.assertNotIn("password", text.lower(), f.name)
            self.assertNotRegex(text, r"[A-Z]:\\|/Users/|/home/", f.name)


if __name__ == "__main__":
    unittest.main()
