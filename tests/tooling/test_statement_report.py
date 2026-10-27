import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cp_script_statement_report", ROOT / "scripts" / "statement_report.py")
sr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sr)

EVIDENCE_NONE = {"browser": False, "human_review": False, "merged_pr": False}
EVIDENCE_ALL = {"browser": True, "human_review": True, "merged_pr": True}


def stmt(id, tests, target=True, evidence=EVIDENCE_NONE):
    return {"id": id, "oct27_target": target, "tests": tests, "release_evidence": evidence}


class SummarizeTests(unittest.TestCase):
    def test_statement_needs_every_one_of_its_tests_to_pass(self):
        rows = sr.summarize([stmt("CP-02", ["a", "b"])], {"a": "ok", "b": "FAIL"})
        self.assertEqual(rows[0]["tests_status"], "RED")
        self.assertEqual(rows[0]["failing"], ["b"])

    def test_test_that_never_ran_is_missing_not_green(self):
        rows = sr.summarize([stmt("CP-02", ["a", "b"])], {"a": "ok"})
        self.assertEqual(rows[0]["tests_status"], "RED")
        self.assertEqual(rows[0]["missing"], ["b"])

    def test_skipped_test_does_not_count_as_passing(self):
        self.assertEqual(sr.summarize([stmt("CP-02", ["a"])], {"a": "skipped"})[0]["tests_status"], "RED")

    def test_statement_without_tests_is_red(self):
        self.assertEqual(sr.summarize([stmt("CP-02", [])], {})[0]["tests_status"], "RED")

    def test_green_tests_alone_are_not_release_complete(self):
        row = sr.summarize([stmt("CP-02", ["a"])], {"a": "ok"})[0]
        self.assertEqual((row["tests_status"], row["release_complete"]), ("GREEN", False))
        done = sr.summarize([stmt("CP-02", ["a"], evidence=EVIDENCE_ALL)], {"a": "ok"})[0]
        self.assertTrue(done["release_complete"])

    def test_counts_only_target_statements(self):
        rows = sr.summarize([stmt("CP-01", ["a"]), stmt("CP-30", ["b"], target=False)], {"a": "ok", "b": "ok"})
        self.assertEqual(sr.totals(rows, target_only=True), {"statements": 1, "tests_green": 1, "release_complete": 0})

    def test_parse_outcomes_reads_verbose_unittest_output(self):
        out = ("test_a (tests.m.C.test_a) ... ok\n"
               "test_b (tests.m.C.test_b)\nDocstring line ... FAIL\n"
               "test_c (tests.m.C.test_c) ... skipped 'x'\n")
        self.assertEqual(sr.parse_outcomes(out), {"tests.m.C.test_a": "ok", "tests.m.C.test_b": "FAIL", "tests.m.C.test_c": "skipped"})


PW_REPORT = {"suites": [
    {"title": "public.spec.ts", "file": "public.spec.ts", "specs": [
        {"title": "public requirements", "tests": [{"projectName": "d", "status": "expected"}]}], "suites": []},
    {"title": "student-flow.spec.ts", "file": "student-flow.spec.ts", "specs": [], "suites": [
        {"title": "student flow", "specs": [
            {"title": "a", "tests": [{"projectName": "d", "status": "expected"}]},
            {"title": "b", "tests": [{"projectName": "d", "status": "unexpected"}]},
            {"title": "c", "tests": [{"projectName": "d", "status": "skipped"}]}], "suites": []}]}]}


class BrowserTests(unittest.TestCase):
    def test_parse_playwright_json_builds_map_style_ids(self):
        self.assertEqual(sr.parse_playwright(PW_REPORT), {
            "e2e/tests/public.spec.ts::public requirements": "ok",
            "e2e/tests/student-flow.spec.ts::student flow > a": "ok",
            "e2e/tests/student-flow.spec.ts::student flow > b": "FAIL",
            "e2e/tests/student-flow.spec.ts::student flow > c": "skipped"})

    def test_browser_status_is_separate_from_tests_status(self):
        s = {**stmt("CP-01", ["a"]), "browser_tests": ["x", "y"]}
        row = sr.summarize([s], {"a": "ok", "x": "ok", "y": "FAIL"})[0]
        self.assertEqual((row["tests_status"], row["browser_status"]), ("GREEN", "RED"))
        self.assertEqual(sr.summarize([s], {"a": "ok"})[0]["browser_status"], "NOT RUN")
        self.assertEqual(sr.summarize([stmt("CP-01", ["a"])], {"a": "ok"})[0]["browser_status"], "NONE")
        ok = sr.summarize([s], {"a": "ok", "x": "ok", "y": "ok"})[0]
        self.assertEqual(ok["browser_status"], "GREEN")

    def test_skipped_browser_test_is_not_green(self):
        s = {**stmt("CP-01", ["a"]), "browser_tests": ["x"]}
        self.assertEqual(sr.summarize([s], {"a": "ok", "x": "skipped"})[0]["browser_status"], "RED")


class RealMapTests(unittest.TestCase):
    def test_every_mapped_test_id_points_at_an_existing_test_method(self):
        statements = sr.load_map(ROOT)
        self.assertEqual(len(statements), 34)
        for s in statements:
            for tid in s["tests"]:
                self.assertTrue(sr.test_exists(ROOT, tid), f"{s['id']}: {tid} not found in source")


if __name__ == "__main__":
    unittest.main()
