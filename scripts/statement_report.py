"""Statement -> test report derived from actual outcomes.

    python scripts/statement_report.py [--all] [--no-run]

Reads schemas/statement-test-map.json (owned by Harsh), runs the named tests and
prints, per statement, whether ALL its tests passed (tests-green) separately from
release evidence (browser flow, human review, merged PR) recorded in the map.
Tests-green is never reported as release-complete. Exit 1 if any selected
statement is not tests-green.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTCOME_RE = re.compile(r"\(([\w.]+)\)\n?[^\n]*?\.\.\. (ok|FAIL|ERROR|skipped)")


def load_map(root):
    return json.loads((Path(root) / "schemas" / "statement-test-map.json").read_text(encoding="utf-8"))["statements"]


def parse_outcomes(text):
    return {tid: status for tid, status in OUTCOME_RE.findall(text)}


def test_exists(root, test_id):
    """True if the dotted id's module file defines the class and method."""
    parts = test_id.split(".")
    if len(parts) < 3:
        return False
    module, cls, method = parts[:-2], parts[-2], parts[-1]
    path = Path(root).joinpath(*module).with_suffix(".py")
    if not path.is_file():
        return False
    src = path.read_text(encoding="utf-8")
    return re.search(rf"^class {cls}\b", src, re.M) is not None and re.search(rf"def {method}\b", src) is not None


def summarize(statements, outcomes):
    rows = []
    for s in statements:
        tests = s["tests"]
        failing = [t for t in tests if outcomes.get(t) in ("FAIL", "ERROR", "skipped")]
        missing = [t for t in tests if t not in outcomes]
        green = bool(tests) and not failing and not missing
        evidence = s.get("release_evidence", {})
        browser = s.get("browser_tests", [])
        if not browser:
            browser_status = "NONE"
        elif any(b not in outcomes for b in browser):
            browser_status = "NOT RUN"
        else:
            browser_status = "GREEN" if all(outcomes[b] == "ok" for b in browser) else "RED"
        rows.append({"id": s["id"], "target": s.get("oct27_target", False), "tests": len(tests),
                     "browser_status": browser_status,
                     "tests_status": "GREEN" if green else "RED", "failing": failing, "missing": missing,
                     "release_complete": green and bool(evidence) and all(evidence.values())})
    return rows


def totals(rows, target_only=True):
    sel = [r for r in rows if r["target"] or not target_only]
    return {"statements": len(sel), "tests_green": sum(r["tests_status"] == "GREEN" for r in sel),
            "release_complete": sum(r["release_complete"] for r in sel)}


def parse_playwright(report):
    out = {}

    def walk(suite, file, path):
        for spec in suite.get("specs", []):
            statuses = {t["status"] for t in spec.get("tests", [])}
            if not statuses or statuses == {"skipped"}:
                status = "skipped"
            elif statuses <= {"expected", "skipped"}:
                status = "ok"
            else:
                status = "FAIL"
            out[f"e2e/tests/{file}::" + " > ".join(path + [spec["title"]])] = status
        for child in suite.get("suites", []):
            walk(child, file, path + [child["title"]])

    for top in report.get("suites", []):
        walk(top, top.get("file", top["title"]), [])
    return out


def run_browser(root):
    import os
    import shutil
    import tempfile
    npm = shutil.which("npm")
    if not npm or not (Path(root) / "e2e" / "node_modules").is_dir():
        return {}
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pw.json"
        env = {**os.environ, "COURSEPATH_PYTHON": sys.executable, "PLAYWRIGHT_JSON_OUTPUT_NAME": str(out)}
        subprocess.run([npm, "--prefix", "e2e", "test", "--", "--reporter=json"], cwd=root, env=env,
                       capture_output=True, text=True)
        return parse_playwright(json.loads(out.read_text(encoding="utf-8"))) if out.is_file() else {}


def run_outcomes(root, statements):
    ids = sorted({t for s in statements for t in s["tests"]})
    py = [t for t in ids if t.startswith("tests.")]
    dj = [t for t in ids if t.startswith("server.")]
    outcomes = {}
    if py:
        p = subprocess.run([sys.executable, "-m", "unittest", "-v", *py], cwd=root, capture_output=True, text=True)
        outcomes.update(parse_outcomes(p.stdout + p.stderr))
    if dj and (Path(root) / "server" / "manage.py").is_file():
        p = subprocess.run([sys.executable, "server/manage.py", "test", *dj, "-v", "2"], cwd=root, capture_output=True, text=True)
        outcomes.update(parse_outcomes(p.stdout + p.stderr))
    return outcomes


def main(argv=None, root=ROOT):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="report all statements, not only the 27 Oct targets")
    ap.add_argument("--browser", action="store_true", help="also run the e2e Playwright suite (needs ports 8000/4173 free)")
    args = ap.parse_args(argv)
    statements = [s for s in load_map(root) if args.all or s.get("oct27_target")]
    outcomes = run_outcomes(root, statements)
    if args.browser:
        outcomes.update(run_browser(root))
    rows = summarize(statements, outcomes)
    print("Statement  Tests  Tests-status  Browser   Release-complete  Notes")
    for r in rows:
        note = ("failing: " + ", ".join(t.split(".")[-1] for t in r["failing"]) if r["failing"] else "") + \
               ("missing: " + ", ".join(t.split(".")[-1] for t in r["missing"]) if r["missing"] else "")
        print(f"{r['id']:<10} {r['tests']:<6} {r['tests_status']:<13} {r['browser_status']:<9} {str(r['release_complete']):<17} {note}")
    t = totals(rows, target_only=False)
    print(f"\n{t['tests_green']}/{t['statements']} statements tests-green; {t['release_complete']} release-complete "
          "(needs browser flow, review and merged PR evidence from the map).")
    return 0 if t["tests_green"] == t["statements"] else 1


if __name__ == "__main__":
    sys.exit(main())
