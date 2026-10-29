---
name: coursepath
description: Team workflow for building CoursePath (IITGN B.Tech CSE degree audit and semester planner) without bugs or integration breakage between the three workstreams. Use for ANY work in this repository - starting or resuming an H/A/M task card, writing SPEC statements or tests, changing coursepath/, server/, frontend/, e2e/, data/, schemas/, examples/, scripts/ or CI, preparing or reviewing a pull request, rebasing or merging a teammate's branch, deploying, or handling the 16 November acceptance-run feature request.
---

# CoursePath team skill

Three people (Harsh, Aaryan, Manashree) build one app in parallel. Most failures in a project shaped like this are not bugs inside one person's slice. They come from drift between slices: a renamed field, a stale mock, a SPEC mapping that points at a deleted test, a migration nobody ran, a secret committed by `git add .`. This skill is the procedure that prevents that drift, and `scripts/preflight.py` checks it mechanically.

The documents below remain the source of truth. If this skill and a document disagree, the document wins: say so and propose a fix to the skill in the same PR.

| Need | Source of truth |
| --- | --- |
| Product scope, academic rules, architecture | `docs/implementation-roadmap.md` |
| Approved academic interpretations: course identity, buckets, caps, grades, prerequisites | `docs/academic-decisions.md` (wins over the roadmap's §3 and §5 where they differ) |
| Ownership, checkpoints, definition of done | `docs/team/README.md` |
| Field names, types, API routes, error codes | `docs/team/contracts.md`, then `schemas/coursepath-v1.schema.json` + `examples/` once merged |
| The current person's task cards | `docs/team/harsh.md`, `aaryan.md`, `manashree.md` |
| Promised behavior and its tests | `SPEC.md` + `schemas/statement-test-map.json` |
| Backend routes and setup | `server/README.md` |
| Hackathon rules and judging | `docs/reference/hackathon-2026-10-09.html` |

Read only the sections the task needs. Don't re-read all of them every session.

## 0. Establish who, what, where (start of every session)

1. **Who.** Work out the owner from `git config user.name`, or ask. The owner decides which files may be edited (`docs/team/README.md` → Ownership).
2. **What.** Name the task card (for example H07, A03 or M02) and the CP IDs it serves. If a request matches no card, map it to the nearest card or say it is outside the agreed scope ("Decisions already settled" lists what is out).
3. **Where.** Run `python .claude/skills/coursepath/scripts/preflight.py --quick`. It reports the branch, how far it is behind `origin/main`, private-data risks, files touched outside the owner's boundary and broken SPEC→test links. Fix every FAIL before writing code.

Use the project virtualenv's Python for every command (`.venv/Scripts/python` on Windows, `.venv/bin/python` elsewhere). Otherwise the Django checks report a missing environment.

## 1. The task loop

1. **Branch from a fresh main:** `git fetch origin` then `git switch -c feature/<owner>-<task>-<slug> origin/main`. Use one task card, or a smaller slice of one, per branch. Never commit to `main`.
2. **Spec first.** Find the CP statement in `SPEC.md`. If the behavior is not promised there, it needs a statement. Harsh integrates SPEC; the others propose wording in their PR description or a handoff request.
3. **Test first, and prove the test is honest.**
   - Run the new test and see an *assertion* failure that names the missing behavior. An ImportError is not a valid red test.
   - Take expected values from sources: an advisory page, the transcript control totals, a hand calculation, or Manashree's independent fixtures. Never take them from running the code under test.
   - Add at least one negative case that would catch the most plausible wrong implementation. Examples: P counted in CPI; a failed course earning credit; touching time slots flagged as a clash; unknown flattened to clear; a parent basket total consumed twice.
   - Add the test's ID to `schemas/statement-test-map.json` in the same PR.
4. **Implement inside your boundary only.** If you need a change in another owner's files, send a handoff request (template in §4) and keep going on the parts you own. Use a local stub only behind a development flag.
5. **Verify:** run `python .claude/skills/coursepath/scripts/preflight.py` (the full run, not `--quick`). It must finish with zero FAIL. Fix each WARN or justify it in the PR.
6. **Try it as the user.** Start the stack and do the flow in a browser with synthetic data. For a backend-only slice before the UI exists, use real HTTP. Hackathon rule 3: looking right is not enough, and neither is a passing test that checks the wrong thing.
7. **Open a small PR** (template in §4). Aim for under ~400 changed lines, not counting fixtures and migrations. Large PRs get rubber-stamped, and rubber-stamped PRs are where integration bugs ship. Reviewers rotate: Harsh→Aaryan, Aaryan→Manashree, Manashree→Harsh. Never approve, merge or claim a review on someone else's behalf.
8. **After merge,** post the handoff note (`docs/team/README.md`, start-of-task step 8) so the consumer of your slice can start today, not at the next checkpoint.

A CP counts as done only when all of these hold: its tests are green, it worked when tried as the user, another member reviewed it, and the PR is merged. Report anything short of that as "in progress", with what is missing.

## 2. Non-negotiables

**Academic correctness** (judges will "break something your spec promises")

- Never invent an academic rule, equivalence, prerequisite, basket membership, internship credit or approval. Every rule must come from an advisory page or a numbered decision in `docs/academic-decisions.md`. If neither covers it, use `null` plus an Issue with severity `unknown` or `approval_required`, and the affected requirement must never roll up as satisfied. A new interpretation needs Harsh's decision recorded there first.
- Unknown, empty and clear are three different things. Unknown prerequisites are not "none". A missing timetable is `not_checked`, never "no clashes". A missing denominator is "unavailable", not 0.
- Known traps (decision IDs from `docs/academic-decisions.md`):
  - **Course identity.** Same code or same normalized name means the same course. Partial name matches need review. Project and special-topics courses are never merged by name (D-01).
  - **CS 203 is not CS 202** (D-03). CS 203 counts as a discipline elective, and the CS 202 core stays pending until CS 202 is passed.
  - **ES 242(N) is DSA I** (D-04). Keep the raw code as imported, and resolve identity before matching requirements or prerequisites.
  - **Two CS 299 registrations are two separate attempts**, never a repeat (D-01, D-10).
  - **Discipline electives:** any CS-coded course, plus the p. 15 table (D-06).
  - **A course is never split between buckets.** Overflow beyond a requirement is surplus (D-07).
  - **SC 372 is a one-credit short course.** Keep it on the record; it never counts toward graduation (D-08).
  - **P earns credit but is excluded from CPI.** A P on a normally letter-graded course is a pass/fail conversion and uses up the online pool. FP 100, GE, PE, IN records and the viva are always P/F, never conversions (D-11, D-12).
  - **Repeated courses:** the best grade counts (D-15).
  - **E is a fail for credit.** It counts as exposure only where a rule says so.
  - **The viva needs a P in every active semester** (D-16).
  - **Prerequisites are team recommendations,** shown as warnings that never block a plan. A course with no entry is `unknown` (D-17).
  - **A 3- or 6-month internship grants no credit by itself.**
- The server is authoritative for every academic number. The frontend formats values; it never computes totals, CPI, eligibility or allocations.

**Data and engineering**

- Credits are `Decimal` in Python and decimal strings in JSON (`"4"`, `"1.5"`), never floats.
- Internal date and time intervals are end-exclusive. Two intervals overlap when `a.start < b.end and b.start < a.end`.
- Every mutation carries `expected_revision`. A stale revision returns 409: never overwrite silently, and never auto-retry with the new revision.
- Every personal query filters by the session owner. A foreign ID returns 404.
- `coursepath/` never imports Django, HTTP or UI code.

**Repository**

- Never commit any of these:
  - the three personal files (the transcript PDF, the graduation-plan XLSX and `copied_input.txt`);
  - `server/.local/`, `*.sqlite3` or `.env`;
  - a real name or roll number in a fixture or screenshot.
- Stage explicit paths (`git add <paths>`). Never use `git add .` or `git add -A`.
- Never edit a test's expected value to match current output. If an expected value looks wrong, show the source evidence and get the test's owner to agree.
- Never use `skip`, `xfail` or a mock fallback to make a suite or a release path green.
- Log AI use in the contributor's own `lab-notes/class-NN.md`. Ask for the real class number; never guess it, and never write the entry for another person.

## 3. Integration rules

This is where most of the breakage happens. The full seam-by-seam checklist is in [reference/integration.md](reference/integration.md). The core rules:

- **Contract changes.** A contract change is one PR that updates `schemas/`, `examples/` and every consumer, or it bumps the schema version. Prefix its title with `[contract]` and tag the other two people.
- **Mocks.** Frontend mocks *are* the files in `examples/` (loaded or generated from them), not hand-written lookalikes. If an example is wrong, fix the example.
- **Rebasing.** Rebase on `origin/main` before opening a PR, and again before merging if main has moved. Re-run the full preflight on the rebased branch, because a green branch plus a green main can still make a red merge.
- **Merge order** follows the dependency chain: contract → backend endpoint → frontend switches to the real API → e2e test. Don't merge a frontend that depends on an endpoint that isn't on main yet, unless it is behind a dev flag.
- **Main is always green and deployable.** If main breaks, fixing it outranks everything else: revert first, debug afterwards.

## 4. Templates

PR description:

```markdown
## What
<user-visible behavior>
Task: H05 · Statements: CP-08, CP-09

## Evidence
- Tests: `<exact commands>` → <ran/passed/failed counts>
- Tried as user: <steps, synthetic data, browser or real HTTP>
- Preflight: 0 FAIL; WARN: <each one, fixed or justified>
- Honesty check: <the intentional defect you introduced, the test that caught it, and that you reverted it>

## Contract / migration impact
<none | changed fields or routes, migration names, consumers updated in this PR>

## Known limits and data gaps
<unknowns, source blockers with affected CP IDs>
```

Cross-boundary handoff request (post it in the team channel or as a GitHub issue):

```markdown
To: <owner> · From: <owner> · Task: <id> · Blocks: <CP IDs>
Need: <exact change: file / field / endpoint / command>
Why: <failing test or flow that needs it>
Proposed shape: <JSON fragment or function signature>
Until then I will: <stub behind dev flag | work on X>
```

## 5. Modes

- **Reviewing a teammate's PR:** follow [reference/review.md](reference/review.md).
- **Deploying, or anything that says "production" or "hosted":** follow [reference/deploy.md](reference/deploy.md).
- **The 16 November acceptance run** (an outsider's unseen feature request), or a rehearsal of it: follow [reference/acceptance-run.md](reference/acceptance-run.md).
- **Blocked on official academic data:**
  1. Record the gap with the affected CP IDs in `docs/data/data-gaps.md`. Manashree owns that file; the others propose entries.
  2. Keep working on the independent parts of the task.
  3. Tell the user which promises are at risk.
  4. Never substitute plausible-looking data.

## 6. Reporting back

End every piece of work with:

- what changed;
- the exact commands run and their results;
- the preflight summary;
- what was *not* verified;
- the next step or handoff.

State plainly which checks failed or were skipped. Saying "should work" or "done" without that evidence is how integration bugs reach the demo.
