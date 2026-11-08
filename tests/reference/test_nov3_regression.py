"""M03/M05 full-feature regressions against Harsh's H11 (clashes) and H12 (internships).

Expected values come from docs/team/source-findings.md (documented timetable cells and
the example plan) and hand arithmetic, never from running the code under test. The
calendar below is deliberately synthetic test input, independent of the committed
2026-27 calendar (data/calendars/2026-27.json, D-24), so these cases do not move when
the institute calendar changes."""
import json
import tempfile
import unittest
from copy import deepcopy
from datetime import date
from pathlib import Path

from coursepath.calendar import add_calendar_months
from coursepath.data_sources.timetable_xlsx import build_snapshot
from coursepath.internships import compare_internships, evaluate_internship
from coursepath.timetable import check_meetings
from tests.data_sources.workbook_factory import build_workbook, course_row
from tests.reference.test_sample_reconciliation import documented_rows

ROOT = Path(__file__).resolve().parents[2]
CONTROLS = json.loads((ROOT / "tests" / "reference_fixtures" / "expected_timetable_controls.json").read_text(encoding="utf-8"))
PLAN_FIXTURE = json.loads((ROOT / "tests" / "reference_fixtures" / "expected_example_plan.json").read_text(encoding="utf-8"))


def snapshot_from(rows=None, place=None):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "tt.xlsx"
        build_workbook(path, rows or [], place=place)
        snap, _ = build_snapshot(path, "2026-27-I", "SRC-TIMETABLE")
    return snap


def item(code, item_id=None):
    return {"id": item_id or code.replace(" ", "").lower(), "normalized_code": code}


def overlaps(result):
    return sorted((c["weekday"], c["start_minute"], c["end_minute"]) for c in result["conflicts"])


class DocumentedClashTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snap = snapshot_from(place=documented_rows())

    def expected(self, key):
        return sorted((e["weekday"], e["start_minute"], e["end_minute"]) for e in CONTROLS["expected_overlaps"][key])

    def test_ph202_es667_lecture_clashes_on_both_documented_slots(self):
        result = check_meetings([item("PH 202"), item("ES 667")], self.snap)
        self.assertEqual(result["status"], "conflicts")
        self.assertEqual(overlaps(result), self.expected("PH 202 vs ES 667"))
        self.assertEqual({tuple(c["kinds"]) for c in result["conflicts"]}, {("lecture", "lecture")})

    def test_ph202_cs331_clash_is_the_h2_tutorial_only(self):
        result = check_meetings([item("PH 202"), item("CS 331")], self.snap)
        self.assertEqual(overlaps(result), self.expected("PH 202 vs CS 331"))
        self.assertEqual([c["kinds"] for c in result["conflicts"]], [["tutorial", "tutorial"]])

    def test_undated_meetings_give_a_possible_clash_not_a_certain_one(self):
        # Active date ranges are unknown in the supplied snapshot (AMB-13).
        result = check_meetings([item("PH 202"), item("ES 667")], self.snap)
        self.assertTrue(all(not c["certain"] for c in result["conflicts"]))
        self.assertTrue(all(i["severity"] == "warning" for i in result["issues"] if i["code"] == "TIMETABLE_CONFLICT"))

    def test_duplicate_source_rows_do_not_create_extra_clashes(self):
        # CS 202 rows 27 and 110 are identical; D1 is Tuesday 10:00, no documented course shares it.
        result = check_meetings([item("CS 202"), item("PH 202")], self.snap)
        self.assertNotIn((1, 600, 680), overlaps(result))
        self.assertEqual(len({c["id"] for c in result["conflicts"]}), len(result["conflicts"]))

    def test_unknown_lab_alternatives_give_a_possible_clash_never_clear(self):
        # CS 202 lab J2,M2 are alternatives, one per student (D-26); a lecture in J2 may clash with whichever slot is assigned.
        place = {**documented_rows(), 300: course_row("ZZ 101", "Synthetic J2 lecture", 4, "J2")}
        result = check_meetings([item("CS 202"), item("ZZ 101")], snapshot_from(place=place))
        self.assertEqual(overlaps(result), [(4, 840, 920)])
        self.assertFalse(result["conflicts"][0]["certain"])
        self.assertEqual(result["status"], "conflicts")

    def test_course_missing_from_snapshot_is_not_checked(self):
        result = check_meetings([item("PH 202"), item("CS 999")], self.snap)
        self.assertEqual(result["per_item"]["cs999"], "not_checked")
        self.assertNotEqual(result["status"], "clear")

    def test_no_snapshot_is_not_checked_never_clear(self):
        result = check_meetings([item("PH 202"), item("ES 667")], None)
        self.assertEqual(result["status"], "not_checked")
        self.assertEqual(result["conflicts"], [])


class IntervalEdgeTests(unittest.TestCase):
    def snap_with(self, meetings_a, meetings_b):
        snap = snapshot_from([course_row("ZZ 101", "A", 4, "B1"), course_row("ZZ 102", "B", 4, "D1")])
        for o, meetings in zip(snap["offerings"], (meetings_a, meetings_b)):
            o["meeting_groups"][0]["meetings"] = [{**o["meeting_groups"][0]["meetings"][0], **m, "id": f"{o['id']}:m{i}"}
                                                  for i, m in enumerate(meetings)]
        return snap

    def test_touching_endpoints_do_not_clash(self):
        snap = self.snap_with([{"weekday": 1, "start_minute": 510, "end_minute": 590}],
                              [{"weekday": 1, "start_minute": 590, "end_minute": 670}])
        self.assertEqual(check_meetings([item("ZZ 101"), item("ZZ 102")], snap)["status"], "clear")

    def test_same_slot_in_different_halves_of_term_does_not_clash(self):
        first = {"weekday": 1, "start_minute": 510, "end_minute": 590, "active_start_date": "2026-08-03", "active_end_date": "2026-09-28"}
        second = {**first, "active_start_date": "2026-09-28", "active_end_date": "2026-11-23"}
        snap = self.snap_with([first], [second])
        self.assertEqual(check_meetings([item("ZZ 101"), item("ZZ 102")], snap)["status"], "clear")

    def test_dated_overlapping_required_meetings_are_a_certain_error(self):
        first = {"weekday": 1, "start_minute": 510, "end_minute": 590, "active_start_date": "2026-08-03", "active_end_date": "2026-11-23"}
        snap = self.snap_with([first], [{**first, "start_minute": 560, "end_minute": 640}])
        result = check_meetings([item("ZZ 101"), item("ZZ 102")], snap)
        self.assertEqual(overlaps(result), [(1, 560, 590)])
        self.assertTrue(result["conflicts"][0]["certain"])


SYNTHETIC_CALENDAR = {"id": "synthetic-test-calendar", "terms": [
    {"id": "2026-27-II", "start_date": "2027-01-04", "end_date_exclusive": "2027-05-03", "exams": []},
    {"id": "2026-27-SUMMER", "start_date": "2027-05-17", "end_date_exclusive": "2027-07-12", "exams": []},
    {"id": "2027-28-I", "start_date": "2027-08-02", "end_date_exclusive": "2027-12-06", "exams": []}]}
PLAN = {"id": "p", "revision": 2, "semesters": [
    {"term_id": "2026-27-SUMMER", "courses": [{"id": "sum1", "normalized_code": "ZZ 150", "credits": "4"}]},
    {"term_id": "2027-28-I", "courses": [{"id": "sem7a", "normalized_code": "ZZ 400", "credits": "4"}]}]}
CONTEXT = {"attempts": [], "catalogue": {}, "approvals": [], "record_revision": 5}


def case(choice, start=None, end=None, mode="onsite_full_time", modules=()):
    return {"id": f"i-{choice}", "duration_choice": choice, "preset": "custom", "start_date": start,
            "end_date_exclusive": end, "placement_mode": mode, "modules": list(modules)}


def example_modules():
    """The example plan's proposal: 12 open-elective + 4 HSS credits, as four 4-credit modules."""
    split = PLAN_FIXTURE["internship_proposal"]["proposed_credits"]
    targets = ["open_elective"] * (int(split["open_elective"]) // 4) + ["hss"] * (int(split["hss"]) // 4)
    return [{"id": f"m{i}", "credits": "4", "intended_allocation": t, "status": "proposed"} for i, t in enumerate(targets)]


class InternshipTests(unittest.TestCase):
    def test_calendar_month_arithmetic_on_leap_and_month_end(self):
        self.assertEqual(add_calendar_months(date(2027, 11, 30), 3), date(2028, 2, 29))
        self.assertEqual(add_calendar_months(date(2026, 8, 31), 6), date(2027, 2, 28))
        self.assertEqual(add_calendar_months(date(2027, 5, 17), 3), date(2027, 8, 17))

    def test_none_has_no_dates_no_credit_and_rejects_stale_modules(self):
        r = evaluate_internship(CONTEXT, case("none"), PLAN, SYNTHETIC_CALENDAR)
        self.assertEqual((r["start_date"], r["credits"]["approved"], r["credits"]["proposed"]), (None, "0", "0"))
        stale = evaluate_internship(CONTEXT, case("none", modules=example_modules()), PLAN, SYNTHETIC_CALENDAR)
        self.assertIn("INTERNSHIP_STALE_MODULES", [i["code"] for i in stale["issues"]])
        self.assertEqual(stale["credits"]["proposed"], "0")

    def test_six_months_alone_earns_zero_credit(self):
        r = evaluate_internship(CONTEXT, case("six_months", "2027-05-17", "2027-11-17"), PLAN, SYNTHETIC_CALENDAR)
        self.assertEqual((r["credits"]["earned"], r["credits"]["approved"], r["credits"]["proposed"]), ("0", "0", "0"))

    def test_example_12oe_4hss_stays_proposed_without_approval(self):
        r = evaluate_internship(CONTEXT, case("six_months", "2027-05-17", "2027-11-17", modules=example_modules()), PLAN, SYNTHETIC_CALENDAR)
        self.assertEqual(r["credits"]["proposed"], "16")
        self.assertEqual(r["credits"]["proposed_by_target"], {"open_elective": "12", "hss": "4"})
        self.assertEqual((r["credits"]["approved"], r["credits"]["earned"]), ("0", "0"))
        self.assertIn("INTERNSHIP_APPROVAL_REQUIRED", [i["code"] for i in r["issues"]])

    def test_student_reported_approval_does_not_become_verified(self):
        mods = [{**m, "approval_ref": "ap1"} for m in example_modules()]
        ctx = {**CONTEXT, "approvals": [{"id": "ap1", "status": "user_reported", "covered_entities": [m["id"] for m in mods]}]}
        r = evaluate_internship(ctx, case("six_months", "2027-05-17", "2027-11-17", modules=mods), PLAN, SYNTHETIC_CALENDAR)
        self.assertEqual(r["credits"]["approved"], "0")

    def test_caps_16_overall_8_hss_4_open_project(self):
        five = [{"id": f"m{i}", "credits": "4", "intended_allocation": "open_elective", "status": "proposed"} for i in range(5)]
        r = evaluate_internship(CONTEXT, case("six_months", "2027-05-17", "2027-11-17", modules=five), PLAN, SYNTHETIC_CALENDAR)
        self.assertEqual(r["credits"]["proposed"], "16")
        hss = [{"id": f"h{i}", "credits": "4", "intended_allocation": "hss", "status": "proposed"} for i in range(3)]
        hss += [{"id": f"o{i}", "credits": "4", "intended_allocation": "open_project", "status": "proposed"} for i in range(2)]
        r = evaluate_internship(CONTEXT, case("six_months", "2027-05-17", "2027-11-17", modules=hss), PLAN, SYNTHETIC_CALENDAR)
        self.assertEqual(r["credits"]["proposed_by_target"], {"hss": "8", "open_project": "4"})

    def test_summer_internship_blocks_summer_courses_only(self):
        r = evaluate_internship(CONTEXT, case("three_months", "2027-05-17", "2027-07-12"), PLAN, SYNTHETIC_CALENDAR)
        self.assertEqual(r["affected_courses"], ["sum1"])
        self.assertEqual([t["term_id"] for t in r["overlapping_terms"]], ["2026-27-SUMMER"])

    def test_six_month_internship_spanning_semester_7_exposes_its_courses(self):
        r = evaluate_internship(CONTEXT, case("six_months", "2027-07-01", "2028-01-01"), PLAN, SYNTHETIC_CALENDAR)
        self.assertIn("sem7a", r["affected_courses"])
        conflict = [i for i in r["issues"] if i["code"] == "INTERNSHIP_ATTENDANCE_CONFLICT"]
        self.assertTrue(conflict and all(i["severity"] == "error" for i in conflict))

    def test_remote_placement_needs_permission_not_a_silent_pass(self):
        r = evaluate_internship(CONTEXT, case("six_months", "2027-07-01", "2028-01-01", mode="remote_or_part_time"), PLAN, SYNTHETIC_CALENDAR)
        sev = {i["severity"] for i in r["issues"] if i["code"] == "INTERNSHIP_ATTENDANCE_CONFLICT"}
        self.assertEqual(sev, {"approval_required"})

    def test_without_a_calendar_nothing_is_reported_clear(self):
        r = evaluate_internship(CONTEXT, case("three_months", "2027-05-17", "2027-08-17"), PLAN, None)
        self.assertIn("CALENDAR_MISSING", [i["code"] for i in r["issues"]])
        self.assertEqual(r["affected_courses"], [])
        self.assertEqual(sorted(r["unchecked_courses"]), ["sem7a", "sum1"])

    def test_three_cases_compare_on_one_untouched_baseline(self):
        plan, ctx = deepcopy(PLAN), deepcopy(CONTEXT)
        out = compare_internships(ctx, plan, SYNTHETIC_CALENDAR, [
            case("none"), case("three_months", "2027-05-17", "2027-08-17"),
            case("six_months", "2027-05-17", "2027-11-17", modules=example_modules())])
        self.assertEqual((plan, ctx), (PLAN, CONTEXT))
        self.assertEqual((out["baseline_record_revision"], out["baseline_plan_revision"]), (5, 2))
        self.assertEqual([c["approved_credits"] for c in out["cases"]], ["0", "0", "0"])


if __name__ == "__main__":
    unittest.main()
