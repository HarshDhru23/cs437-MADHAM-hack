---
name: spec-status
description: Report which SPEC.md statements (CP-01, CP-02, ...) are green, red, or untested in CoursePath. Use when someone asks "where are we", "what is left", "is the spec green", or before opening a pull request.
---

# Spec status

1. Read `SPEC.md`. The current statement list is the table under
   "October 27 implementation scope". List every statement ID (CP-01, CP-02, ...)
   with a short title (a few words from its "Checkable statement" column).
2. Find the tests for each statement. In this repo they are mapped in
   `schemas/statement-test-map.json` (`tests` per statement ID). Python domain tests
   live under `tests/`, Django API tests under `server/`; method names start with
   the statement, for example `test_cp09_...`.
3. Run the mapped tests once with the repo's own report (Windows; use
   `.venv/bin/python` elsewhere):
   `.venv/Scripts/python scripts/statement_report.py --all`
   Do not add `--browser` or `--frontend` unless asked. Do not run tests another way.
4. Print one table, nothing else before it:

   | ID | Statement | Tests | Result |
   |----|-----------|-------|--------|

   Tests is the report's `Tests` count. Result is:
   - **green**: report says `GREEN`;
   - **no test**: the `Tests` count is 0 and Browser and Frontend are both `NONE`
     (the report prints these as RED; they are not);
   - **UI only**: the `Tests` count is 0 but Browser or Frontend tests are mapped
     (`NOT RUN`); say they run with `--browser` / `--frontend`;
   - **red**: anything else; give the first failing or missing test name from the
     report's Notes column.
5. Under the table, at most three lines: the count of green / red / no test / UI only,
   and the one statement to work on next (the first red, else the first
   untested). Green means its tests pass, not that it is release-complete.

Do not edit any file. Do not fix anything. This skill only reports.
