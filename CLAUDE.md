# CoursePath

Three-person team project (Harsh, Aaryan, Manashree) for CS437 at IIT Gandhinagar. Before doing any work in this repository, load the `coursepath` skill (`.claude/skills/coursepath/SKILL.md`) and follow its task loop. Run `python .claude/skills/coursepath/scripts/preflight.py --quick` at the start of a session and the full preflight before every PR.

Sources of truth: `docs/team/README.md` (ownership, checkpoints), `docs/team/contracts.md` (shapes and API), `SPEC.md` (promised behavior and tests), `docs/implementation-roadmap.md` (scope and academic rules), `docs/academic-decisions.md` (approved academic interpretations; wins over the roadmap where they differ).

- Run: `python scripts/run.py` (Django API on 8000, Vite on 5173). Stop it before testing.
- Test: `python scripts/test.py` (`--suite python` to narrow). Statement status: `python scripts/statement_report.py --all`.
- Use the project virtualenv's Python (`.venv/Scripts/python` on Windows, `.venv/bin/python` elsewhere).
- Layout: domain logic `coursepath/` (no Django), API `server/`, UI `frontend/src/`, tests `tests/`, `server/`, `e2e/`. Statements CP-NN in `SPEC.md`, mapped to tests in `schemas/statement-test-map.json`.
- Never edit an existing test to make the suite pass. Stage explicit paths, never `git add .`. Never commit private inputs (transcript, IMS paste, graduation plan, advisory PDF).
- Branches: `feature/<owner>-<task>-<slug>`; never put "claude" or "codex" in a branch name.
