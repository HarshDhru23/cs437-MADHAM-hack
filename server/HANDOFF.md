# Harsh — November 3 block handoff

Prepared 31 October 2026 (IST) as stacked branches from `origin/main`
`ece371c`, then opened as stacked PRs #10 to #18 (#10 is merged; the rest are
in review and merge in order). Only committed repository files were used as
sources.

| Branch (stacked in this order) | PR | Task | Statements |
| --- | --- | --- | --- |
| `feature/harsh-h11-offerings-clashes` | #10 (merged) | H11 offerings and clashes | CP-23, CP-24 |
| `feature/harsh-h12-internships` | #11 | H12 internships and IN 498 modules | CP-33, CP-34 |
| `feature/harsh-h13-scenarios` | #12 | H13 scenarios, compare, plan apply | CP-28 (and the CP-33/34 API) |
| `feature/harsh-h13-export` | #13 | H13 export and restore | CP-30 |
| `feature/harsh-h14-privacy` | #14 | H14 deletion, preview purge, production check | CP-32 |
| `feature/harsh-d04-course-identity` | #15 | D-01 to D-04 identity groups | CP-13, CP-17, CP-19, CP-22 |
| `feature/harsh-d17-recommended-prerequisites` | #16 | `[contract]` D-17 recommended preparation | CP-05, CP-22 |
| `feature/harsh-h15-nov3-integration` | #17 | H15 SPEC status and this note | none |
| `feature/harsh-h06-adv13-curriculum` | #18 | H06 reviewed curriculum from ADV13; D-19 to D-21 | CP-03, CP-12, CP-14, CP-15, CP-17 to CP-20 |

The last branch was added later on 31 Oct, after Harsh authorized the local
ADV13 PDF as the curriculum source. It needs three companion changes before it
can merge, because it intentionally changes behavior other owners' tests pin:

```markdown
To: Aaryan · From: Harsh · Task: H06 · Blocks: CP-01, CP-03
Need: e2e/tests/public.spec.ts expects "These rules are a draft" and version
cse-2024-draft-v1; the curriculum is now cse-2024-v1, review_status reviewed,
with no SOURCE_MISSING issue. e2e/tests/student-flow.spec.ts finds the heading
"Tools"; the requirement label is now "Software Tools and Techniques for CSE"
(id still "tools"). The assertion's intent (shows CS 202, not Satisfied) holds.
Also: requirement results carry surplus_credits; the viva node carries
missing_terms; mark TEAM decisions (decision field) in the requirement view.
Until then I will: keep the branch unmerged; nothing else in the UI broke
(frontend suite: 230 passed).
```

```markdown
To: Manashree · From: Harsh · Task: H06 · Blocks: CP-03
Need: tests/reference/test_service_regression.py
test_draft_curriculum_never_certifies_the_sample_record assumes a draft
curriculum (no requirement satisfied). Proposed: keep assertFalse(complete),
and assert the CS 202 "tools" requirement is pending and SC 372 is excluded with
reason ONE_CREDIT_SHORT_COURSE. Data register: GAP-04, GAP-05, GAP-09, GAP-10
and AMB-01 to 05, 08, 09 can close (D-01 to D-21); GAP-06 is partly closed
(best grade decided, CPI rounding open).
Until then I will: keep the branch unmerged.
```

Timetable: a draft snapshot was built locally (not committed) from the
supplied workbook with `scripts/build_timetable.py`:
`server/.local/timetable/2026-27-I.draft.json` and `.report.json` (workbook
SHA-256 `43df3926...dc1e6`, unchanged by the build). 303 offerings, 30 slots,
732 meetings, 0 errors. To review before `load_offerings --reviewed`:
publication/finality and coverage (AMB-11); 54 lab/tutorial groups with unstated
alternatives (AMB-12); 0 meetings have active dates, so every clash is
"possible" (AMB-13); 38 unrecognized rows; 4 sessions given as text; duplicate
conflicting rows for IN 101 and MSE 317; 16 offerings with no meetings. With the
H11 engine the draft reproduces the PH 202 / ES 667 lecture clashes (Tue B1,
Fri B2) and the PH 202 / CS 331 H2 tutorial clash.

H10 (CP-25 to CP-27) is not started: D-18 defers it until the AI minor document
and the CSE honours list exist (GAP-07).

## Changed interfaces

- New routes: `GET /offerings`, `/scenarios` (CRUD, `compare`, `{id}/apply-plan`),
  `GET /export`, `POST /imports/backup-preview` (committed through
  `/imports/{id}/commit` with `confirm: true`), `DELETE /account/data`. See
  `server/README.md`.
- Plan validation adds `offering_status`, `offering_ids` and
  `meeting_check_status` per course and `meeting_checks` per term.
- `PREREQUISITE_MISSING` is now severity `warning`, labelled "Recommended
  preparation (CoursePath team)"; unlisted courses stay `PREREQUISITE_UNKNOWN`.
- Schema additions: `offering_snapshot`, `meeting`, `scenario`,
  `scenario_list`, `scenario_comparison`, `plan_apply`, `backup`,
  `backup_preview`, `account_deletion`; curriculum `identity_groups`; source
  kind `team_decision` and authority `team`. Examples: `offerings.json` (new),
  `internship-comparison.json` (regenerated from the engine).
- Migration `0003_offeringsnapshot`; staff commands `load_offerings` and
  `purge_previews`.

## Verification

- `python .claude/skills/coursepath/scripts/preflight.py` on the top branch:
  0 WARN; one FAIL, `SPEC -> tests` for CP-25, CP-26 and CP-27 (blocked by
  D-18). `scripts/test.py` (Python, Django, frontend, e2e) passed.
- Every new test was run red first (assertion failures against stubs), and a
  deliberate defect per slice was caught and reverted: touching meetings
  counted as a clash; unknown meetings flattened to clear; self-claimed module
  approval; inclusive interval ends; apply without the stale check; restore
  without the owner check; deletion without re-authentication; allocation
  without identity resolution; recommendation severity back to error.
- Real HTTP on an isolated SQLite database: signup, IMS import, plan,
  scenarios, compare, apply, export, backup preview and deletion all behaved as
  specified. No browser was used; that evidence is Aaryan's.

## Open dependencies

- Aaryan: scenario/internship comparison UI against
  `examples/internship-comparison.json` and `/scenarios/compare`; section
  choice and clash panel from `meeting_checks`; print view; data-deletion page
  with the retention text; "recommended preparation (CoursePath team)" wording.
  D-21 makes imported, current, planned and hypothetical rows degree learning
  by default (#18); the record editor's manual rows still default to `unknown`
  (`RecordPage.tsx`, Aaryan's follow-up from the #18 review).
- Manashree: a reviewed 2026-27 Semester I snapshot (`build_timetable.py`, then
  `load_offerings --reviewed --coverage ...`), lab alternative semantics
  (AMB-12), quad dates (AMB-13) and the 2026-27 calendar (GAP-03). GAP-08 can
  move to closed for H11 to H14. Proposed register updates: GAP-04 and AMB-04
  resolved by D-04; AMB-08 per-quad limit dropped by D-14.
- Harsh: D-05 to D-16 encoding in the curriculum and grading policy (discipline
  electives by CS prefix, project order, online pool, P/F conversions, best
  grade, viva); the institute core, maths, science and HSS lists need a committed
  source first.

# Harsh — October 27 backend handoff

Prepared 23 October 2026 (IST), on `feature/harsh-oct27-backend`, from committed
baseline `372862a`. No checkpoint work existed beyond five placeholder functions;
the initial five tests were run and failed before implementation. The committed
roadmap, team instructions, contracts, source findings and Harsh card were read.
No frontend, root orchestration, timetable adapter, other member's fixtures or
untracked user documents were edited. The user subsequently authorized local use
of the supplied PDF and IMS paste; no other uncommitted academic source was used.

## Task IDs and completion limits

These are implementation results, not fabricated peer approvals or release
certification. The team's definition of done also requires browser integration,
review by another teammate and a merged PR; those gates have not happened here.

| Task | Implemented and verified | Remaining acceptance dependency |
| --- | --- | --- |
| H01 | All 34 SPEC IDs, immutable domain values, decimal serialization, v1 machine schema, synthetic examples and real API/schema checks. | Aaryan/Manashree contract review; source-specific independent row fixtures. |
| H02 | Django accounts/session/password/CSRF/throttle, owned records/attempts/previews/plans, scenario/approval/snapshot models, migrations, transactional revision checks and real HTTP restart persistence. | Human/browser integration, hosted PostgreSQL tests and peer review. Scenario/export routes remain November scope. |
| H03 | Coordinate-block PDF parser; wrapped titles, controls, profile candidates, duplicate-text deduplication, unsupported/encrypted/image-only handling and bounded subprocess extraction. Real supplied transcript controls pass. | Independent full-row oracle, more layouts/continuation samples and frontend review flow. Unanchored continuation layouts fail visibly rather than guessing. |
| H04 | IMS table and bounded whitespace/multiline variants, shared code/term/grade normalization, original order/provenance, rejected rows, distinct registrations. Real paste controls pass. | Independent full-row oracle and frontend integration. |
| H05 | Owned one-hour previews, selection/corrections with justifications/history, conflict resolution, same-source identity, reported vs extracted controls, atomic commit, rollback and confirmed current-enrolment input. Record corrections preserve source evidence. | Real UI review/commit flow; ambiguity review for same-term repeated registrations. Expired preview purging belongs to H14. |
| H06 | Validating source/cohort/rule loader and staff CLI; reconciled 170-credit draft, hierarchical baskets, unresolved PE/viva obligations and draft grading metadata. | **Blocked for approved-data completion:** official committed source pages/amendments, catalogue memberships, equivalences and exceptional policies. No institutional review was invented. |
| H07 | Deterministic exclusive bounded allocation; mandatory/all/any/course-count/credit/set rules; cap-aware search, ledger, deficits, exclusions and separate actual/current/projected results. | Real reviewed dataset, special-cap/approval/zero-credit policies and independent hand audit. Missing policies prevent unconditional completion. |
| H08 | Legacy wrappers, immutable add/remove edits, full-plan PATCH for moves, downstream validation, nested AND/OR, explicit E exposure/co-requisites/minimum grade, conditional planned prerequisites and load checks. | Reviewed per-course prerequisite/repeat/load/standing data. No catalogue prefix inference; meetings/offerings remain not checked. |
| H09 | Decimal cumulative/term points and denominators, contributing/excluded attempts, E/F inclusion, P/zero exclusion, explicit rounding/cap policy, missing-policy and repeat issues; source-reported controls kept separately. | Official applicable rounding/repeat/withdrawal/thesis/additional-learning policy. A numeric reconciliation alone does not verify those policies. |

The independent coding portions of H01–H05 and H07–H09 are ready for review;
H06 has only a draft and validation infrastructure. No entire H task or CP is
claimed to meet the team's reviewed/merged/browser definition of done yet.
H10–H15 remain the November 3 block, not silently included in this delivery.

## Verification evidence

Python 3.12.14 with Django 5.2.18 and the committed dependency lock was used for
the final checks. Development tests were also run on Python 3.13.4.

- `python -m unittest discover -s tests -v`: 38 tests with the opt-in real-input
  check enabled; default CI explicitly skips that one private-source test.
- `python server/manage.py test server.records -v 1`: 15 tests, including real
  localhost HTTP and actual server process restart, owner isolation, CSRF,
  password-change invalidation, stale revisions, PDF commit and database rollback.
- `python server/manage.py check`; `makemigrations --check --dry-run`;
  `git diff --check`: clean. Production `check --deploy` with ephemeral test
  environment settings is checked separately; it does not connect to or verify
  a hosted database.
- TDD red runs preceded schema, account, parser, reconciliation, loader,
  allocation, planning, metrics and endpoint implementations. Regression tests
  also caught unknown-child roll-up, erased reported controls, unreasoned record
  corrections, unsupported admission-year coercion and a missing security header.
- A synthetic 40-attempt/10-basket allocation, including all three views:
  median 8.22 ms, max 8.86 ms over ten local runs; 41 actual-view search nodes.
  Default budgets: 100,000 nodes and 0.5 seconds per allocation view. Exhaustion
  emits `ALLOCATION_UNRESOLVED`. This is not a benchmark on an approved real audit.

The local source controls matched the committed roadmap: PDF 39 attempts,
10/10/10/9 rows and credits 28/22/28/26 (104); IMS 40 attempts and credits
28/23/28/26 (105); both preserve the two CS 299 registrations and ES 242(N).
Both reproduce 849 points and 92 performance credits, whose two-decimal
half-up arithmetic is 9.23. That rounding choice is explicitly synthetic in
the test policy; the API leaves display recalculation unavailable until official
rounding is supplied, and exposes the transcript's reported CPI separately.
No private row list, identity header, PDF, paste or rendered inspection image is
committed. The temporary inspection image was removed.

## Data and integration dependencies

- Manashree: obtain/review the official 2024 curriculum amendments, actual basket
  membership/catalogue, equivalences (especially CS 203/202 and CS 421/431),
  ES 242(N) treatment, repeated CS 299 and SC 372 classification, grading and
  project/exposure/viva/load policies. The untracked advisory/timetable were not
  used as sources under the user's committed-files constraint.
- The supplied transcript confirms its printed grade legend and ordinary
  arithmetic; it does not supply the missing exceptional/repeat policy. Source
  approval and official catalogue completion are still open.
- Aaryan: connect account, import/review, record, requirements, planner and metrics
  screens to the implemented routes in `server/README.md`. Verify phone/keyboard,
  correction→commit→reload and two real browser sessions. The actual HTTP test
  is not substituted for browser/student acceptance.
- Manashree: wire the actual backend commands into owned root setup/README/CI,
  plus Aaryan's commands once they exist. No root scripts were invented here.
  Run PostgreSQL concurrency/persistence in CI/staging and supply independent
  anonymized row oracles. Root README still describes the historical scaffold.
- Harsh: consume those reviewed versions through `load_rules`, fill catalogue/
  prerequisite policies, rerun source-backed audit/performance and resolve
  integration findings. Migrations `0001_initial` and
  `0002_academicrecord_reported_controls` require the normal `migrate` step.
- Aaryan is the proposed human reviewer for Harsh; no person was impersonated,
  contacted, assigned or claimed to have approved this work. Record actual AI
  assistance in Harsh's real class lab note after the class number is supplied;
  no class number/interview/submission history was invented.

Next handoff: Aaryan takes the schema/examples and real routes; Manashree takes
the runnable commands, source gaps and independent-oracle request. Harsh's next
dependent work is H06 source approval and the resulting H07/H09 validation,
followed by peer review and the required PR merge. Do not count the October 27
17/34 green gate until the full integration and reviewed merge actually pass.
