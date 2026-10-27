"""One test command for CoursePath.

    python scripts/test.py                  # every required suite
    python scripts/test.py --suite python   # narrow selector for development

Suites: python (unittest, nested discovery), django (server/), frontend
(typecheck, unit tests, build) and e2e (browser). A suite whose code does not
exist yet is reported MISSING and counts as a failure: only the full command
establishes a checkpoint result. Exit code is nonzero on any FAIL or MISSING.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUITES = ("python", "django", "frontend", "e2e")


@dataclass
class Result:
    name: str
    status: str  # PASS | FAIL | MISSING
    tests: int = 0
    detail: str = ""


def exit_code(results):
    return 0 if results and all(r.status == "PASS" for r in results) else 1


def expected_modules(root):
    tests = Path(root) / "tests"
    return {".".join(p.relative_to(root).with_suffix("").parts) for p in tests.rglob("test_*.py")}


def _run(cmd, cwd, env=None, stream=False):
    full_env = {**os.environ, **(env or {})}
    p = subprocess.run(cmd, cwd=cwd, env=full_env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    if stream:
        print(out)
    return p.returncode, out


def _tail(text, n=15):
    return "\n".join(text.strip().splitlines()[-n:])


def run_python_suite(root):
    root = Path(root)
    code, out = _run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", ".", "-v"], root,
                     {"PYTHONPATH": str(root)})
    ran = re.search(r"Ran (\d+) tests?", out)
    count = int(ran[1]) if ran else 0
    executed = {".".join(m.split(".")[:-2]) for m in re.findall(r"\((tests(?:\.\w+)+)\)", out)}
    not_run = sorted(expected_modules(root) - executed)
    if not_run:
        return Result("python", "FAIL", count,
                      "test modules never executed (missing __init__.py or import error?): " + ", ".join(not_run))
    if code != 0:
        return Result("python", "FAIL", count, _tail(out))
    skipped = re.search(r"skipped=(\d+)", out)
    return Result("python", "PASS", count, f"{skipped[1]} skipped (see -v output; e.g. private inputs not supplied)" if skipped else "")


def run_django_suite(root):
    root = Path(root)
    manage = root / "server" / "manage.py"
    if not manage.is_file():
        return Result("django", "MISSING", detail="server/manage.py does not exist")
    code, out = _run([sys.executable, str(manage), "test", "server"], root)
    ran = re.search(r"Ran (\d+) tests?", out)
    skipped = re.search(r"skipped=(\d+)", out)
    detail = f"{skipped[1]} skipped" if skipped else ""
    if code != 0 or not ran:
        return Result("django", "FAIL", int(ran[1]) if ran else 0, _tail(out))
    return Result("django", "PASS", int(ran[1]), detail)


def _npm_scripts(pkg):
    try:
        return json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {})
    except (OSError, ValueError):
        return {}


def run_frontend_suite(root):
    root = Path(root)
    pkg = root / "frontend" / "package.json"
    if not pkg.is_file():
        return Result("frontend", "MISSING", detail="frontend/package.json does not exist")
    npm = shutil.which("npm")
    if not npm:
        return Result("frontend", "FAIL", detail="npm not found on PATH")
    if not (root / "frontend" / "node_modules").is_dir():
        return Result("frontend", "FAIL", detail="dependencies not installed: run `npm ci --prefix frontend`")
    scripts = _npm_scripts(pkg)
    absent = [s for s in ("typecheck", "test", "build") if s not in scripts]
    if absent:
        return Result("frontend", "MISSING", detail="package.json has no script(s): " + ", ".join(absent))
    count = 0
    for step in ("typecheck", "test", "build"):
        code, out = _run([npm, "--prefix", "frontend", "run", step], root)
        if code != 0:
            return Result("frontend", "FAIL", count, f"npm run {step}:\n{_tail(out)}")
        if step == "test":
            m = re.search(r"Tests\s+(?:\d+ failed \| )?(\d+) passed", out)
            count = int(m[1]) if m else 0
    return Result("frontend", "PASS", count, "typecheck, test, build")


E2E_PORTS = (8000, 4173)  # fixed by e2e/playwright.config.ts


def busy_ports(ports):
    import socket
    busy = []
    for port in ports:
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                busy.append(port)
    return busy


def run_e2e_suite(root):
    root = Path(root)
    pkg = root / "e2e" / "package.json"
    if not pkg.is_file() or "test" not in _npm_scripts(pkg):
        return Result("e2e", "MISSING", detail="no e2e/package.json with a `test` script (Aaryan's Playwright suite)")
    npm = shutil.which("npm")
    if not npm:
        return Result("e2e", "FAIL", detail="npm not found on PATH")
    if not (root / "e2e" / "node_modules").is_dir():
        return Result("e2e", "FAIL", detail="dependencies not installed: run `npm ci --prefix e2e` then "
                                            "`npm run install-browsers --prefix e2e`")
    busy = busy_ports(E2E_PORTS)
    if busy:
        return Result("e2e", "FAIL", detail="port(s) in use, the browser suite starts its own servers: "
                                            + ", ".join(map(str, busy)))
    # Playwright starts an isolated temporary-SQLite Django and the production build itself.
    code, out = _run([npm, "--prefix", "e2e", "test"], root, {"COURSEPATH_PYTHON": sys.executable})
    passed = re.search(r"(\d+) passed", out)
    skipped = re.search(r"(\d+) skipped", out)
    detail = f"{skipped[1]} skipped" if skipped else ""
    if code != 0:
        return Result("e2e", "FAIL", int(passed[1]) if passed else 0, _tail(out, 25))
    return Result("e2e", "PASS", int(passed[1]) if passed else 0, detail)


RUNNERS = {"python": run_python_suite, "django": run_django_suite,
           "frontend": run_frontend_suite, "e2e": run_e2e_suite}


def main(argv=None, root=ROOT):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--suite", action="append", choices=SUITES, help="run only this suite (repeatable)")
    args = p.parse_args(argv)
    selected = args.suite or list(SUITES)
    results = []
    for name in selected:
        print(f"== {name} ...", flush=True)
        results.append(RUNNERS[name](root))
    print("\nSuite      Status    Tests  Detail")
    for r in results:
        first = r.detail.splitlines()[0] if r.detail else ""
        print(f"{r.name:<10} {r.status:<9} {r.tests:<6} {first}")
    for r in results:
        if r.status != "PASS" and r.detail:
            print(f"\n--- {r.name}: {r.status}\n{r.detail}")
    if args.suite:
        print("\nNarrow selector used: this is not a checkpoint result.")
    code = exit_code(results)
    print("\nRESULT:", "all required suites passed" if code == 0 else "FAILED (see above)")
    return code


if __name__ == "__main__":
    sys.exit(main())
