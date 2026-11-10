"""Row-level oracles for the supplied transcript/IMS samples (M01.3, M05).

Two oracles, neither produced by a parser:
- tests/reference_fixtures/synthetic_transcript_rows.json (committed): the
  sample's structure and public controls with invented courses and grades.
  The synthetic IMS tests use it and always run, including in CI.
- real_transcript_oracle.json (never committed): the rows hand-transcribed from
  the real transcript, kept beside the private originals in
  COURSEPATH_REAL_INPUT_DIR (default: the repository root, git-ignored). The
  real-file tests compare the parsers against it and are skipped, visibly,
  when it or the originals are absent.
The parsers, reconciliation and performance code under test are Harsh's public services."""
import json
import os
import unittest
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from coursepath.imports.ims import parse_ims
from coursepath.imports.pdf_transcript import parse_pdf
from coursepath.imports.reconcile import reconcile_import
from coursepath.performance import calculate_performance

ROOT = Path(__file__).resolve().parents[2]
ORACLE = json.loads((ROOT / "tests" / "reference_fixtures" / "synthetic_transcript_rows.json").read_text(encoding="utf-8"))
REAL_DIR = Path(os.environ.get("COURSEPATH_REAL_INPUT_DIR") or ROOT)
REAL_PDF = next(REAL_DIR.glob("[0-9]*B.Tech*.pdf"), REAL_DIR / "sample_transcript.pdf")   # named after the roll number: matched by pattern
REAL_IMS = REAL_DIR / "copied_input.txt"
REAL_ORACLE_PATH = REAL_DIR / "real_transcript_oracle.json"
REAL_ORACLE = json.loads(REAL_ORACLE_PATH.read_text(encoding="utf-8")) if REAL_ORACLE_PATH.is_file() else None

# Independent grade table, from the transcript legend (not imported from the engine).
POINTS = {k: Decimal(v) for k, v in ORACLE["grade_points"].items()}
POLICY = {"id": "oracle-policy", "review_status": "reviewed", "points": {k: str(v) for k, v in POINTS.items()},
          "excluded_grades": ["P"], "rounding": "half_up", "decimal_places": 2, "cpi_cap": "10", "spi_cap": None,
          "repeat_policy": "count_all", "additional_learning_policy": "include", "source_refs": ["oracle"]}


def oracle_rows(with_ims_extra, oracle=None):
    oracle = oracle or ORACLE
    out = []
    for term, rows in oracle["terms"].items():
        out += [(term, *r) for r in rows]
    if with_ims_extra:
        for term, rows in oracle["ims_only_rows"].items():
            out += [(term, *r) for r in rows]
    return sorted(out)


def parsed_rows(result):
    return sorted((a["term_id"], a["normalized_code"], a["title"], a["credits"], a["grade"])
                  for a in result["candidate_attempts"])


def term_label(term_id):
    year, short, half = term_id.split("-")
    return f"{year}-20{short} Semester {half}"


def ims_text(rows):
    """Synthetic IMS paste in the sample's reverse-chronological tab layout."""
    ordered = sorted(rows, key=lambda r: (r[0].split("-")[0], r[0].split("-")[2]), reverse=True)
    lines = ["Academic Period\tCourse No\tCourse Name\tCredit\tGrade"]
    lines += [f"{term_label(t)}\t{c}\t{n}\t{cr}\t{g}" for t, c, n, cr, g in ordered]
    return "\n".join(lines) + "\n"


class OracleSelfCheck(unittest.TestCase):
    def test_oracle_totals_recomputed_from_rows(self):
        total_pts = total_perf = total_earned = Decimal(0)
        for term, rows in ORACLE["terms"].items():
            credits = sum(Decimal(r[2]) for r in rows)
            perf = sum(Decimal(r[2]) for r in rows if r[3] != "P")
            pts = sum(Decimal(r[2]) * POINTS[r[3]] for r in rows if r[3] != "P")
            exp = ORACLE["expected_per_term"][term]
            self.assertEqual((len(rows), str(credits), str(perf), str(pts)),
                             (exp["rows"], exp["credits"], exp["performance_credits"], exp["points"]), term)
            total_pts, total_perf, total_earned = total_pts + pts, total_perf + perf, total_earned + credits
        rep = ORACLE["reported_by_transcript"]
        self.assertEqual((str(total_earned), str(total_perf), str(total_pts)),
                         (rep["total_credits_earned"], rep["credits_counted_towards_performance"], rep["total_cumulative_points"]))
        self.assertEqual((total_pts / total_perf).quantize(Decimal("0.01"), ROUND_HALF_UP), Decimal(rep["cpi"]))
        self.assertEqual(sum(len(r) for r in ORACLE["terms"].values()), 39)

    def test_special_rows_present_in_oracle(self):
        codes = Counter(r[0] for rows in ORACLE["terms"].values() for r in rows)
        self.assertEqual(codes["CS 299"], 2)
        self.assertEqual(codes["ES 242(N)"], 1)
        self.assertEqual(sum(1 for c in codes if c.startswith("PE ")), 4)
        self.assertEqual(sum(1 for c in codes if c.startswith("IN ")), 4)
        self.assertNotIn("SC 372", codes)


class SyntheticImsParserTests(unittest.TestCase):
    def test_parser_recovers_every_oracle_row_in_its_term(self):
        rows = oracle_rows(True)
        result = parse_ims(ims_text(rows), "synthetic-ims")
        self.assertEqual(parsed_rows(result), rows)
        self.assertEqual(len(rows), 40)
        self.assertEqual(result["unparsed_rows"], [])

    def test_repeated_cs299_and_variant_suffix_preserved(self):
        result = parse_ims(ims_text(oracle_rows(True)), "synthetic-ims")
        cs299 = [a for a in result["candidate_attempts"] if a["normalized_code"] == "CS 299"]
        self.assertEqual(sorted(a["term_id"] for a in cs299), ["2025-26-I", "2025-26-II"])
        self.assertEqual(len({a["id"] for a in cs299}), 2)
        self.assertEqual([a["credits"] for a in result["candidate_attempts"] if a["normalized_code"] == "ES 242(N)"], ["4"])

    def test_term_credit_sums_and_ims_difference(self):
        c = parse_ims(ims_text(oracle_rows(True)), "synthetic-ims")["extracted_controls"]
        self.assertEqual(c["attempt_count"], 40)
        self.assertEqual(c["raw_credits"], "105")
        self.assertEqual([c["terms"][t]["raw_credits"] for t in sorted(c["terms"])], ["28", "23", "28", "26"])

    def test_crlf_and_non_breaking_space_variants_parse_identically(self):
        text = ims_text(oracle_rows(True)).replace("\n", "\r\n").replace("Semester", "Semester ", 3).replace("  ", " ")
        self.assertEqual(parsed_rows(parse_ims(text, "s")), oracle_rows(True))

    def test_performance_matches_independent_arithmetic(self):
        attempts = parse_ims(ims_text(oracle_rows(True)), "s")["candidate_attempts"]
        result = calculate_performance(attempts, POLICY)
        cum = result["cumulative"]
        rep = ORACLE["reported_by_transcript"]
        self.assertEqual((cum["grade_points"], cum["performance_credits"], cum["display_value"]),
                         (rep["total_cumulative_points"], rep["credits_counted_towards_performance"], rep["cpi"]))
        got = {t["term_id"]: (t["grade_points"], t["performance_credits"], t["display_value"]) for t in result["terms"]}
        for term, exp in ORACLE["expected_per_term"].items():
            spi = Decimal(exp["spi_unrounded"]).quantize(Decimal("0.01"), ROUND_HALF_UP)
            self.assertEqual(got[term], (exp["points"], exp["performance_credits"], str(spi)), term)

    def test_p_grades_and_zero_credit_rows_excluded_with_reasons(self):
        attempts = parse_ims(ims_text(oracle_rows(True)), "s")["candidate_attempts"]
        excluded = calculate_performance(attempts, POLICY)["cumulative"]["excluded_attempts"]
        p_or_zero = [a for a in attempts if a["grade"] == "P" or a["credits"] == "0"]
        self.assertEqual({e["attempt_id"] for e in excluded}, {a["id"] for a in p_or_zero})
        # Hand count: 5 credited P rows (FP 100, GE 101, GE 201, ES 336, SC 372) + 8 zero-credit PE/IN rows.
        self.assertEqual(len(excluded), 13)
        self.assertEqual(sum(1 for a in attempts if a["credits"] == "0"), 8)
        reasons = Counter(e["reason"] for e in excluded)
        self.assertEqual(reasons, Counter({"PERFORMANCE_EXCLUDED_GRADE": 5, "ZERO_CREDIT": 8}))
        cum = calculate_performance(attempts, POLICY)["cumulative"]
        self.assertEqual(cum["issues"], [])
        self.assertTrue(cum["complete"])

    def test_reimport_of_same_source_does_not_duplicate_or_double_credit(self):
        preview = parse_ims(ims_text(oracle_rows(True)), "synthetic-ims")
        first = reconcile_import({"attempts": [], "revision": 0}, preview, {})
        again = reconcile_import(first["record"], preview, {})
        self.assertEqual(len(first["record"]["attempts"]), 40)
        self.assertEqual(again["record"]["attempts"], first["record"]["attempts"])
        self.assertTrue(all(d["status"] == "unchanged" for d in again["diff"]))
        credits = sum(Decimal(a["credits"]) for a in again["record"]["attempts"])
        self.assertEqual(credits, Decimal(105))

    def test_changed_grade_on_reimport_is_a_conflict_not_a_silent_overwrite(self):
        rows = oracle_rows(True)
        record = reconcile_import({"attempts": [], "revision": 0}, parse_ims(ims_text(rows), "synthetic-ims"), {})["record"]
        original = next(g for t, c, n, cr, g in rows if c == "ES 204")
        revised = "B" if original != "B" else "A"
        changed = [(t, c, n, cr, revised if c == "ES 204" else g) for t, c, n, cr, g in rows]
        result = reconcile_import(record, parse_ims(ims_text(changed), "synthetic-ims"), {})
        self.assertEqual([d["status"] for d in result["diff"]].count("conflicting"), 1)
        self.assertIn("IMPORT_CONFLICT", [i["code"] for i in result["issues"]])
        self.assertEqual(next(a for a in result["record"]["attempts"] if a["normalized_code"] == "ES 204")["grade"], original)

    def test_malformed_row_is_visible_and_other_rows_survive(self):
        text = ims_text(oracle_rows(True)) + "2025-2026 Semester II\tNOT A COURSE\tBad\tx\n"
        result = parse_ims(text, "s")
        self.assertEqual(len(result["candidate_attempts"]), 40)
        self.assertEqual(len(result["unparsed_rows"]), 1)


@unittest.skipUnless(REAL_IMS.is_file() and REAL_ORACLE, f"real IMS paste or local oracle not found in {REAL_DIR}")
class RealImsTests(unittest.TestCase):
    def test_real_ims_matches_oracle_rows(self):
        result = parse_ims(REAL_IMS.read_text(encoding="utf-8-sig"), "local-ims")
        self.assertEqual(parsed_rows(result), oracle_rows(True, REAL_ORACLE))
        self.assertEqual(result["unparsed_rows"], [])


@unittest.skipUnless(REAL_PDF.is_file() and REAL_ORACLE, f"real transcript PDF or local oracle not found in {REAL_DIR}")
class RealPdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = parse_pdf(REAL_PDF.read_bytes(), "local-pdf")

    def test_real_pdf_matches_oracle_rows(self):
        self.assertEqual(parsed_rows(self.result), oracle_rows(False, REAL_ORACLE))
        self.assertEqual(self.result["unparsed_rows"], [])

    def test_real_pdf_reported_controls_vs_extraction(self):
        rep = REAL_ORACLE["reported_by_transcript"]
        c = self.result["extracted_controls"]
        self.assertEqual((c["attempt_count"], c["raw_credits"], c["performance_credits"], c["grade_points"]),
                         (39, rep["total_credits_earned"], rep["credits_counted_towards_performance"], rep["total_cumulative_points"]))

    def test_pdf_and_ims_reconcile_without_duplicates_and_sc372_is_the_only_new_row(self):
        pdf = reconcile_import({"attempts": [], "revision": 0}, self.result, {})
        self.assertEqual(len(pdf["record"]["attempts"]), 39)
        ims = parse_ims(REAL_IMS.read_text(encoding="utf-8-sig"), "local-ims") if REAL_IMS.is_file() else None
        if ims is None:
            self.skipTest("IMS paste not available")
        merged = reconcile_import(pdf["record"], ims, {})
        new = [d for d in merged["diff"] if d["status"] == "new"]
        self.assertEqual(len(new), 1)
        self.assertEqual(len(merged["record"]["attempts"]), 40)
        self.assertEqual([a["normalized_code"] for a in merged["record"]["attempts"] if a["normalized_code"] == "SC 372"], ["SC 372"])


if __name__ == "__main__":
    unittest.main()
