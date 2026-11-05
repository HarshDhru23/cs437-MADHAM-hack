---
name: new-feature
description: Turn a plain-English feature request into a new SPEC.md statement (CP-NN), a failing test, and the code that makes it pass. Use when a user or the 16 November acceptance run asks for a new feature.
---

# New feature, spec first

Work in this order. Do not skip ahead. Use `.venv/Scripts/python` for every Python command.

0. **Branch.** Create and switch to a new branch `feature/<owner>-cp<NN>-<short-name>` from an up-to-date `origin/main` before touching any file. Name it this way:
   - `<owner>` is the lowercase first name of whoever is running this, from `git config user.name`; for example `manashree`.
   - `<NN>` is the next free statement number: one more than the highest `CP-NN` anywhere in `SPEC.md`, so currently 35. Withdrawn numbers (CP-25 to CP-27) are never reused.
   - Example: `git fetch origin` and then `git switch -c feature/manashree-cp35-<short-name> origin/main`.
   - Branch names never contain "claude" or "codex".
1. **Restate.** Write the request back as one checkable sentence, in the style of the existing statements in `SPEC.md` ("A student can ..."). Ask one question and stop in either of these cases:
   - The request is ambiguous.
   - It needs an academic rule that `docs/academic-decisions.md` and `docs/implementation-roadmap.md` do not already settle. Examples are a credit, a cap, a grade rule, an equivalence or a requirement membership. `docs/academic-decisions.md` wins where the two differ.

   Never invent academic rules. If you stop here, nothing was changed: switch back to the branch you started on and delete the empty branch from step 0 (`git branch -d feature/<owner>-cp<NN>-<short-name>`), so the next run can reuse CP-NN.
2. **Spec.** Add CP-NN as a new row in the current statement table in `SPEC.md`, the "October 27 implementation scope" table: `| CP-NN | <statement> | <how it will be checked> |`. In the same step, add its entry to `schemas/statement-test-map.json`, copying the fields of an existing entry, with `tests` listing the test from step 3. `tests/domain/test_statement_map.py` fails if the two files disagree. `tests/tooling/test_statement_report.py` (`RealMapTests`) asserts the number of statements in the map. Raise that count by one in this same step and update its comment. This is spec bookkeeping, not a change to make code pass, so name it in the commit and the PR. Do not change any other existing test. `SPEC.md` and the map are Harsh's, so say so in the PR.
3. **Failing test.** Add a `test_cpNN_...` method in the right module:
   - for domain logic in `coursepath/`, a module under `tests/domain/`, e.g. `tests/domain/test_planning.py`;
   - for the API in `server/`, a `server/records/test_*.py` module, e.g. `server/records/test_analysis.py`.

   Take its expected values from sources (`SPEC.md`, `docs/academic-decisions.md`, committed data, hand arithmetic), never from running the code.

   Run it alone, with `.venv/Scripts/python -m unittest tests.domain.<module>.<Class>.test_cpNN_...` or `.venv/Scripts/python server/manage.py test server.records.<module>.<Class>.test_cpNN_...`. Then run `.venv/Scripts/python scripts/test.py --suite python --suite django` and show two things:
   - The new test fails with an assertion, not an ImportError, AttributeError or other error.
   - Every old test still passes.

   If the new test passes already, the test is wrong: fix the test, not the code.
4. **Code.** Change the smallest amount of code in `coursepath/` or `server/` that makes it pass.
5. **Check.** Run `.venv/Scripts/python scripts/test.py --suite python --suite django`. Then run the `spec-status` skill, if it is in the repo yet.
6. **Commit** on that branch, one commit, message `CP-NN: <statement>`. Stage explicit paths only. Do not push and do not merge: a teammate reviews the pull request.

Never edit or delete an existing test to make the suite pass.
