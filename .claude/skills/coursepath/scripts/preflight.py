#!/usr/bin/env python3
"""CoursePath team preflight: catches the integration mistakes unit tests miss.

Run with the project's virtualenv Python from anywhere inside the repository:

    python .claude/skills/coursepath/scripts/preflight.py            # full
    python .claude/skills/coursepath/scripts/preflight.py --quick    # skip suites
    python .claude/skills/coursepath/scripts/preflight.py --owner aaryan

Checks: branch state, private data and secrets, file ownership, SPEC-to-test
links, Django system/migration checks and the test suites. Exits 1 if any check
FAILs. Uses only the standard library so it runs before setup is complete.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

PASS, WARN, FAIL, SKIP = "PASS", "WARN", "FAIL", "SKIP"
RESULTS: list[tuple[str, str, str]] = []

# First matching pattern wins; keep specific patterns above general ones.
# Mirrors the Ownership table in docs/team/README.md.
OWNERSHIP = [
    ("coursepath/data_sources/*", "manashree"),
    ("coursepath/*", "harsh"),
    ("server/*", "harsh"),
    ("schemas/*", "harsh"),
    ("examples/*", "harsh"),
    ("data/offerings/*", "manashree"),
    ("data/calendars/*", "manashree"),
    ("data/source-manifest.json", "manashree"),
    ("data/*", "harsh"),
    ("requirements*", "harsh"),
    ("SPEC.md", "harsh"),
    (".env.example", "harsh"),
    ("tests/reference/*", "manashree"),
    ("tests/reference_fixtures/*", "manashree"),
    ("tests/data_sources/*", "manashree"),
    ("tests/*", "harsh"),
    ("frontend/*", "aaryan"),
    ("e2e/*", "aaryan"),
    ("docs/ui/*", "aaryan"),
    ("scripts/*", "manashree"),
    (".github/*", "manashree"),
    ("README.md", "manashree"),
    ("docs/data/*", "manashree"),
    ("docs/operations/*", "manashree"),
    ("docs/qa/*", "manashree"),
    ("docs/demo.md", "manashree"),
    ("docs/submissions/2026-10-27.md", "manashree"),
    ("lab-notes/*", "self"),
    (".claude/*", "shared"),
    ("CLAUDE.md", "shared"),
    (".gitignore", "shared"),
    ("docs/*", "shared"),
]
NAME_HINTS = {"harsh": "harsh", "dhru": "harsh", "aaryan": "aaryan", "manashree": "manashree"}

PRIVATE_NAMES = {
    "24110107-B.Tech-ASSISTANTREGISTRAR(ACADEMICS)AT.pdf",
    "24110107_Graduation Plan.xlsx",
    "copied_input.txt",
}
NEVER_COMMIT = ["*.sqlite3", "*.sqlite3-journal", "server/.local/*", ".env", ".env.*",
                "*.pem", "*.key", "*.p12"]
ALLOWED = {".env.example"}

SECRET_FAIL = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "private key"),
    (re.compile(r"SECRET_KEY\s*=\s*['\"][^'\"\s]{30,}['\"]"), "hardcoded Django SECRET_KEY"),
]
SECRET_WARN = [
    (re.compile(r"(?i)\b(password|passwd|api[_-]?key|token)\b['\"]?\s*[:=]\s*['\"][^'\"\s]{6,}['\"]"),
     "credential-looking literal (fine only if synthetic test data)"),
    (re.compile(r"\b24110107\b"), "roll number from the private transcript"),
]


def record(status: str, name: str, detail: str = "") -> None:
    RESULTS.append((status, name, detail))


def run(cmd: list[str], cwd: Path, timeout: int = 900, env: dict | None = None,
        stderr: bool = True) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=timeout, env=env)
    except FileNotFoundError as exc:
        return 127, str(exc)
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s: {' '.join(cmd)}"
    return proc.returncode, (proc.stdout or "") + ((proc.stderr or "") if stderr else "")


def git(root: Path, *args: str) -> tuple[int, str]:
    # stdout only: git prints warnings (e.g. CRLF conversion) on stderr that would parse as paths.
    return run(["git", *args], root, timeout=60, stderr=False)


def lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.strip()]


def tail(text: str, count: int = 25) -> str:
    return "\n".join(text.rstrip().splitlines()[-count:])


def owner_of(path: str) -> str:
    for pattern, owner in OWNERSHIP:
        if fnmatch.fnmatch(path, pattern):
            return owner
    return "unassigned"


def is_never_commit(path: str) -> bool:
    name = path.rsplit("/", 1)[-1]
    if name in ALLOWED:
        return False
    return name in PRIVATE_NAMES or any(
        fnmatch.fnmatch(path, p) or fnmatch.fnmatch(name, p) for p in NEVER_COMMIT)


# ---------------------------------------------------------------- git checks

def check_branch(root: Path, base: str, fetch: bool) -> None:
    if fetch:
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
        code, out = run(["git", "fetch", "--quiet", "origin"], root, timeout=30, env=env)
        if code:
            record(WARN, "fetch", "could not fetch origin; behind-count may be stale")
    _, branch = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    branch = branch.strip()
    _, dirty = git(root, "status", "--porcelain", "--untracked-files=no")
    _, ahead = git(root, "rev-list", "--count", f"{base}..HEAD")
    ahead_n = int(ahead.strip() or 0) if ahead.strip().isdigit() else 0
    if branch in {"main", "master"}:
        if dirty.strip() or ahead_n:
            record(FAIL, "branch", f"changes on {branch}; move them to feature/<owner>-<task>-<slug>")
        else:
            record(WARN, "branch", f"on {branch}; create a feature branch before editing")
    elif not re.match(r"^(feature|fix|docs|chore|test)/", branch):
        record(WARN, "branch", f"'{branch}' does not follow feature/<owner>-<task>-<slug>")
    else:
        record(PASS, "branch", branch)
    code, behind = git(root, "rev-list", "--count", f"HEAD..{base}")
    if code == 0 and behind.strip().isdigit() and int(behind) > 0:
        record(WARN, "up to date", f"{behind.strip()} commits behind {base}; rebase and re-run preflight")
    elif code == 0:
        record(PASS, "up to date", f"contains {base}")


def changed_files(root: Path, base: str) -> list[str]:
    files: set[str] = set()
    for args in (("diff", "--name-only", f"{base}...HEAD"), ("diff", "--name-only", "HEAD"),
                 ("ls-files", "--others", "--exclude-standard")):
        code, out = git(root, *args)
        if code == 0:
            files.update(lines(out))
    return sorted(files)


def check_privacy(root: Path, base: str) -> None:
    _, tracked = git(root, "ls-files")
    bad = [p for p in lines(tracked) if is_never_commit(p)]
    if bad:
        record(FAIL, "private files", "tracked or staged: " + ", ".join(bad[:5])
               + "  (git rm --cached <path>, then add it to .gitignore)")
    else:
        record(PASS, "private files", "none tracked or staged")

    _, history = git(root, "log", f"{base}..HEAD", "--diff-filter=A", "--name-only", "--format=")
    leaked = sorted({p for p in lines(history) if is_never_commit(p)})
    if leaked:
        record(FAIL, "branch history", "added in this branch's commits (deleting is not enough; "
               "rewrite the branch before pushing): " + ", ".join(leaked[:5]))

    _, untracked = git(root, "ls-files", "--others", "--exclude-standard")
    risky = [p for p in lines(untracked) if is_never_commit(p)]
    if risky:
        record(WARN, "ignore rules", "not gitignored, one `git add .` from being committed: "
               + ", ".join(risky[:5]))

    diff = ""
    for args in (("diff", "-U0", f"{base}...HEAD"), ("diff", "-U0", "HEAD")):
        code, out = git(root, *args)
        if code == 0:
            diff += out + "\n"
    fails, warns, current = [], [], "?"
    for line in diff.splitlines():
        if line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else line[4:]
            continue
        if not line.startswith("+") or current.startswith(".claude/skills/coursepath/"):
            continue
        for pattern, label in SECRET_FAIL:
            if pattern.search(line):
                fails.append(f"{current}: {label}")
        for pattern, label in SECRET_WARN:
            if pattern.search(line):
                warns.append(f"{current}: {label}")
    if fails:
        record(FAIL, "secrets", "; ".join(sorted(set(fails))[:5]))
    if warns:
        record(WARN, "secrets", "; ".join(sorted(set(warns))[:5]))
    if not fails and not warns:
        record(PASS, "secrets", "no secret-like additions")


def detect_owner(root: Path, explicit: str | None) -> str | None:
    if explicit:
        return explicit.lower()
    if os.environ.get("COURSEPATH_OWNER"):
        return os.environ["COURSEPATH_OWNER"].lower()
    _, name = git(root, "config", "user.name")
    lowered = name.lower()
    for hint, owner in NAME_HINTS.items():
        if hint in lowered:
            return owner
    return None


def check_ownership(root: Path, base: str, owner: str | None) -> None:
    files = changed_files(root, base)
    if not files:
        record(PASS, "ownership", "no changes yet")
        return
    if not owner:
        record(WARN, "ownership", "could not infer owner; pass --owner harsh|aaryan|manashree")
        return
    foreign, shared, unassigned = {}, [], []
    for path in files:
        who = owner_of(path)
        if who in {owner, "self"}:
            continue
        if who == "shared":
            shared.append(path)
        elif who == "unassigned":
            unassigned.append(path)
        else:
            foreign.setdefault(who, []).append(path)
    if foreign:
        detail = "; ".join(f"{who}: {', '.join(paths[:4])}" + (" ..." if len(paths) > 4 else "")
                           for who, paths in sorted(foreign.items()))
        record(WARN, "ownership", f"{owner} touched other owners' files (needs their agreement): {detail}")
    if unassigned:
        record(WARN, "ownership", "no owner agreed for: " + ", ".join(unassigned[:5]))
    if shared:
        record(PASS if not foreign else WARN, "shared files",
               "shared paths changed, so both other members should see the PR: " + ", ".join(shared[:5]))
    if not foreign and not unassigned and not shared:
        record(PASS, "ownership", f"{len(files)} changed files, all owned by {owner}")


# --------------------------------------------------------------- spec checks

def resolve_test(root: Path, file_parts: list[str], names: list[str]) -> str | None:
    path = root.joinpath(*file_parts[:-1], file_parts[-1] + ".py") if file_parts else None
    if path is None or not path.exists():
        return "missing file"
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(names) >= 2 and not re.search(rf"^\s*class\s+{re.escape(names[0])}\b", text, re.M):
        return f"missing class {names[0]}"
    if names and not re.search(rf"^\s*(async\s+)?def\s+{re.escape(names[-1])}\s*\(", text, re.M):
        return f"missing test {names[-1]}"
    return None


def resolve_js(root: Path, test_id: str, prefix: str) -> str | None:
    """`path::describe > test` IDs used for frontend_tests / browser_tests in the statement map."""
    file_part, _, title = test_id.partition("::")
    if not file_part.startswith(prefix):
        return f"expected a file under {prefix}"
    path = root / file_part
    if not path.exists():
        return "missing file"
    text = path.read_text(encoding="utf-8", errors="replace").replace("\\'", "'").replace('\\"', '"')
    missing = [seg for seg in title.split(" > ") if f"'{seg}'" not in text and f'"{seg}"' not in text]
    return f"title not found: {missing[0]}" if missing or not title else None


def resolve_dotted(root: Path, dotted: str) -> str | None:
    parts = dotted.split(".")
    for split in range(len(parts) - 1, 0, -1):
        candidate = root.joinpath(*parts[:split - 1], parts[split - 1] + ".py")
        if candidate.exists():
            return resolve_test(root, parts[:split], parts[split:])
    return "missing file"


def check_spec(root: Path) -> None:
    spec_path = root / "SPEC.md"
    if not spec_path.exists():
        record(FAIL, "SPEC", "SPEC.md missing")
        return
    spec = spec_path.read_text(encoding="utf-8-sig", errors="replace")
    ids = set(re.findall(r"^\|\s*(CP-\d{2,})\s*\|", spec, re.M))
    problems: list[str] = []

    for file_part, cls, method in re.findall(r"`([\w./-]+)\.py::(\w+)\.(\w+)`", spec):
        error = resolve_test(root, file_part.split("/"), [cls, method])
        if error:
            problems.append(f"SPEC.md -> {file_part}.py::{cls}.{method}: {error}")

    map_path = root / "schemas" / "statement-test-map.json"
    if map_path.exists():
        try:
            statements = json.loads(map_path.read_text(encoding="utf-8"))["statements"]
        except (ValueError, KeyError) as exc:
            record(FAIL, "statement map", f"unreadable: {exc}")
            return
        mapped = {s["id"]: s.get("tests", []) for s in statements}
        local = {s["id"]: s.get("local_tests", []) for s in statements}
        ui = {s["id"]: (s.get("frontend_tests", []), s.get("browser_tests", [])) for s in statements}
        for cp in sorted(ids - set(mapped)):
            problems.append(f"{cp} is in SPEC.md but not in statement-test-map.json")
        for cp in sorted(set(mapped) - ids):
            problems.append(f"{cp} is mapped but not a SPEC.md statement")
        for cp, tests in sorted(mapped.items()):
            frontend, browser = ui[cp]
            if not tests and not frontend and not browser:
                problems.append(f"{cp} has no mapped test (hackathon rule 3)")
            for test_id in [*tests, *local[cp]]:
                error = resolve_dotted(root, test_id)
                if error:
                    problems.append(f"{cp} -> {test_id}: {error}")
            for test_id, prefix in [(t, "frontend/src/") for t in frontend] + [(t, "e2e/tests/") for t in browser]:
                error = resolve_js(root, test_id, prefix)
                if error:
                    problems.append(f"{cp} -> {test_id}: {error}")
        count = sum(len(t) + len(ui[cp][0]) + len(ui[cp][1]) for cp, t in mapped.items())
        scope = f"{len(ids)} statements, {count} mapped tests (Python, frontend and browser)"
    else:
        scope = f"{len(ids)} statements (no statement-test-map.json yet; checked SPEC.md references)"

    if problems:
        record(FAIL, "SPEC -> tests", f"{len(problems)} broken links: " + " | ".join(problems[:6]))
    else:
        record(PASS, "SPEC -> tests", scope)


# ------------------------------------------------------------- suite checks

def has_module(module: str) -> bool:
    code, _ = run([sys.executable, "-c", f"import {module}"], Path.cwd(), timeout=60)
    return code == 0


def check_django(root: Path) -> None:
    manage = root / "server" / "manage.py"
    if not manage.exists():
        record(SKIP, "django", "server/manage.py not on this branch")
        return
    if not has_module("django"):
        record(FAIL, "django", f"Django not importable by {sys.executable}; activate .venv and "
               "pip install -r requirements.txt")
        return
    for name, args in (("django check", ["check"]),
                       ("migrations", ["makemigrations", "--check", "--dry-run"])):
        code, out = run([sys.executable, str(manage), *args], root)
        record(PASS if code == 0 else FAIL, name, "clean" if code == 0 else tail(out, 8))


def summarize_unittest(out: str) -> tuple[int, str]:
    ran = re.search(r"Ran (\d+) tests?", out)
    count = int(ran.group(1)) if ran else 0
    failed = re.findall(r"^(FAIL|ERROR): (\w+) \(([\w.]+)\)", out, re.M)
    # Python 3.11+ prints the full dotted ID in parentheses; older versions omit the method.
    names = [f"{kind} {where if where.endswith('.' + name) else where + '.' + name}"
             for kind, name, where in failed]
    status = re.findall(r"^(OK|FAILED)( \(.*\))?$", out, re.M)
    return count, (status[-1][0] + status[-1][1] if status else "no result line") + (
        ("; " + "; ".join(names[:8])) if names else "")


def check_python_suites(root: Path) -> None:
    if (root / "tests").is_dir():
        code, out = run([sys.executable, "-m", "unittest", "discover", "-s", "tests"], root)
        count, summary = summarize_unittest(out)
        if count == 0:
            record(FAIL, "unit tests", "no tests discovered (missing __init__.py or import error?)\n"
                   + tail(out, 10))
        else:
            record(PASS if code == 0 else FAIL, "unit tests", f"ran {count}: {summary}")
    if (root / "server" / "manage.py").exists() and has_module("django"):
        code, out = run([sys.executable, "server/manage.py", "test", "server"], root)
        count, summary = summarize_unittest(out)
        if count == 0:
            record(FAIL, "django tests", "no Django tests discovered\n" + tail(out, 10))
        else:
            record(PASS if code == 0 else FAIL, "django tests", f"ran {count}: {summary}")


def check_frontend(root: Path) -> None:
    package = root / "frontend" / "package.json"
    if not package.exists():
        record(SKIP, "frontend", "frontend/package.json not on this branch")
        return
    npm = shutil.which("npm")
    if not npm:
        record(FAIL, "frontend", "npm not found on PATH")
        return
    if not (root / "frontend" / "node_modules").is_dir():
        record(FAIL, "frontend", "run `npm ci` in frontend/ first")
        return
    scripts = json.loads(package.read_text(encoding="utf-8")).get("scripts", {})
    env = dict(os.environ, CI="1")
    ran = False
    for name in ("typecheck", "lint", "test", "build"):
        if name in scripts:
            ran = True
            code, out = run([npm, "--prefix", "frontend", "run", name], root, env=env)
            record(PASS if code == 0 else FAIL, f"frontend {name}",
                   "ok" if code == 0 else tail(out, 15))
    if not ran:
        record(WARN, "frontend", "package.json has none of typecheck/lint/test/build scripts")


def check_suites(root: Path) -> None:
    runner = root / "scripts" / "test.py"
    if runner.exists():
        code, out = run([sys.executable, str(runner)], root, timeout=3600)
        record(PASS if code == 0 else FAIL, "scripts/test.py",
               "full suite passed" if code == 0 else tail(out, 30))
        return
    check_python_suites(root)
    check_frontend(root)
    if (root / "e2e").is_dir():
        record(SKIP, "e2e", "run the browser suite via Aaryan's command until scripts/test.py exists")


# -------------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--quick", action="store_true", help="skip Django checks and test suites")
    parser.add_argument("--owner", choices=["harsh", "aaryan", "manashree"], help="whose boundary to check")
    parser.add_argument("--base", help="comparison branch (default origin/main, else main)")
    parser.add_argument("--no-fetch", action="store_true", help="do not git fetch origin first")
    args = parser.parse_args()

    code, top = run(["git", "rev-parse", "--show-toplevel"], Path.cwd(), timeout=30)
    if code:
        print("preflight: not inside a git repository")
        return 2
    root = Path(top.strip())
    base = args.base or ("origin/main" if git(root, "rev-parse", "--verify", "--quiet", "origin/main")[0] == 0
                         else "main")
    owner = detect_owner(root, args.owner)

    check_branch(root, base, fetch=not args.no_fetch)
    check_privacy(root, base)
    check_ownership(root, base, owner)
    check_spec(root)
    if not args.quick:
        check_django(root)
        check_suites(root)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"CoursePath preflight  root={root}  base={base}  owner={owner or '?'}  "
          f"mode={'quick' if args.quick else 'full'}")
    for status, name, detail in RESULTS:
        first, *rest = (detail or "").splitlines() or [""]
        print(f"[{status}] {name}: {first}")
        for extra in rest:
            print(f"         {extra}")
    counts = {s: sum(1 for r in RESULTS if r[0] == s) for s in (PASS, WARN, FAIL, SKIP)}
    print(f"preflight: {counts[PASS]} pass, {counts[WARN]} warn, {counts[FAIL]} fail, {counts[SKIP]} skip")
    return 1 if counts[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
