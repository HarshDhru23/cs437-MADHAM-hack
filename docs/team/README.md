# CoursePath team implementation instructions

Date: 22 October 2026, IST. This package is the implementation handoff. Commit selection is documented in [commit guide](commit-guide.md). No application features are implemented by these documents.

## Read order and authority

1. Read the repository's `AGENTS.md` if present; none was found during this review.
2. Read [product roadmap](../implementation-roadmap.md), [shared contracts](contracts.md), [new workbook findings](source-findings.md), then your assignment: [Harsh](harsh.md), [Aaryan](aaryan.md), or [Manashree](manashree.md).
3. Official, applicable source rules control academic behavior. The example graduation workbook expresses student intent; its totals and labels are not institutional authority. Never invent an equivalence, prerequisite, internship credit, minor requirement or approval.
4. These named instructions supersede the earlier unnamed workstream split. Preserve source documents and the October 9 historical note. Update current README/SPEC as work is actually completed.

## Decisions already settled

- Release cohort: B.Tech CSE admitted in 2024. Awards: base CSE only. CSE honours, the AI minor and their joint evaluation (CP-25 to CP-27) were withdrawn on 3 Nov because their official definitions are unavailable (D-18). Other batches/minors use the same future data interfaces, but are not release promises.
- Full-degree planner: show every remaining semester, initially through semester 8, with an explicit extend-plan action. Do not hardcode eight as the maximum permitted duration. Current supplied timetable applies only to 2026-27 Semester I. Later offerings are tentative/unknown until supported by dated data.
- The current term is not completed history. The June 2026 transcript ends after semester 4; the example's semester-5 plan is not proof of current registration. Ask the student to confirm current enrolment and sections.
- Import choices: PDF transcript or IMS grade-table paste; manual corrections/current-enrolment entry remain available. The example XLSX is a planning reference/fixture, not a third public upload feature.
- Internship scenarios: no internship, 3 months, 6 months. Exact dates are editable; summer and semester presets seed them. Duration, physical availability, approval and academic credit are independent.
- Keep CS 203/CS 202 unresolved. Display the evidence and the unfulfilled/unverified core requirement; do not erase the imported course.
- Student accounts, server persistence and cross-device saving are required. React/TypeScript/Vite frontend, Django API/auth/ORM, pure Python domain, SQLite local and PostgreSQL hosted. Do not introduce a second backend framework or a separate authentication platform.
- No autonomous timetable scraping, IMS credentials, course registration, LLM academic decisions, automatic whole-plan generation or new feature scope beyond the agreed release.

## Ownership

| Owner | Owned code/data boundaries | Required handoffs |
| --- | --- | --- |
| Harsh | Existing `coursepath/*.py`; new domain/imports/rules/performance/awards/scenarios/internships; all Django `server/`; canonical `schemas/`; approved curriculum/grade/award datasets; Python dependency files and backend container/deployment configuration. | Canonical examples and endpoint contract first; parser/audit/validation services; authenticated save APIs; approved rule data; release integration. |
| Aaryan | All `frontend/` source/components/styles/routes/types and frontend dependency lockfile; frontend component tests; `e2e/` browser tests/config; `docs/ui/`. | Typed client and accessible screens against shared examples; real API integration; browser acceptance evidence. |
| Manashree | `coursepath/data_sources/timetable_xlsx.py`; `scripts/build_timetable.py`; timetable/academic-calendar datasets; source manifest/ambiguity register; independent reference fixtures/tests; root run/test orchestration, CI, operating/user docs and demo checklist. | Reviewed timetable draft + provenance; independent sample oracles; reproducible commands/CI; data gaps and release report. |

Harsh owns additions to the domain public contract. An owner may request a small change in another boundary through a documented handoff; do not silently edit another owner's files or expand APIs. Package exports in `coursepath/__init__.py`, `SPEC.md` and backend dependency manifests are integrated by Harsh. Aaryan owns `package.json` under `frontend/`; Manashree wires root scripts to those commands after they exist.

Proposed reviewed-PR rotation: Harsh changes reviewed by Aaryan; Aaryan changes reviewed by Manashree; Manashree changes reviewed by Harsh. Actual approval must come from another member. Agents must never impersonate reviewers or fabricate approvals/contributions.

## Start-of-task instructions for every coding agent

1. Run `git status --short`, inspect current branch/history and any new instructions. Preserve all unrelated/untracked user files. The supplied private inputs must not be added to public fixtures or Git by accident.
2. Use a topic branch such as `feature/harsh-h03-pdf`, `feature/aaryan-a03-import`, or `feature/manashree-m02-timetable`; do not push directly to main. Only create worktrees if the actual working arrangement requires them; separate agents must not share the same working files concurrently.
3. Inspect `SPEC.md`. A promised feature gets its statement and failing behavioral tests before implementation. Keep CP-01..05 and their existing tests meaningful. Coordinate the new statement IDs rather than duplicating them.
4. Read the relevant task card, approved source pages and shared example JSON. Write down prerequisites that are absent. Work on independent tasks while blocked; do not substitute invented data or mark a placeholder complete.
5. Implement only the owned slice; call the shared engine/client instead of reproducing rules in another layer. Add schema/migrations and validation when the slice changes stored data.
6. Run the narrow task tests, then required integration checks. A feature needs both automated evidence and an actual browser/user flow. Tests must fail for the named wrong behavior, not just assert the implementation's own values.
7. In each PR describe behavior, CP IDs, source versions, tests run and remaining data limitations. Record actual AI use in the contributor's actual `lab-notes/class-NN.md`; do not guess the class number or invent an interview.
8. Leave a handoff note with changed interfaces, exact test commands/results, source gaps and next task ID. Do not claim a PR was reviewed/merged unless that happened.

## Specification and checkpoint arithmetic

The roadmap defines CP-01..CP-34. Harsh integrates these into SPEC before feature coding. CP-33 covers internship dates/availability comparisons; CP-34 covers approved modules/allocation. Do not bury them in an untested generic scenario claim.

- October 16 required at least ten statements, one test per statement, runnable app. The inspected local state has five; recover immediately and do not backdate evidence.
- **October 27: at least 17 of 34 statements green**, each delivered through a reviewed merged PR. Planned set: **CP-01 through CP-16, plus CP-29**. Account isolation must already be tested even though the full CP-32 deletion/cleanup scope finishes later.
- **November 3: all 31 green, specification frozen** (34 minus CP-25 to CP-27, withdrawn on 3 Nov under D-18). Data-dependent features require an approved real supported dataset; a synthetic-only test or permanent unknown does not satisfy the release promise.
- The assignment gives dates, not an hour for these checkpoints. Keep the official dates. There are no additional previous-evening checkpoints; confirm any instructor-specific cutoff separately.

## Independent work and actual dependencies

The implementation can proceed in parallel after agreement on the published [contracts](contracts.md). It is not completely independent: the shipped application needs the domain, data, API and UI to connect. The split avoids waiting for another teammate's finished implementation before starting a whole workstream.

| Owner | Can start independently | Needed for final integration |
| --- | --- | --- |
| Harsh | Domain models, PDF/IMS parsers, base academic rules, accounts/persistence and engine tests. Use owned synthetic fixtures while independent source oracles are prepared. | Manashree's reviewed timetable/calendar snapshot and source checks; Aaryan's actual browser flows for end-to-end verification. |
| Aaryan | All screen layouts, components, state handling and component tests against contracts and frontend-local synthetic examples. | Harsh's working endpoints and authoritative analysis; real timetable/section data for final clash flows. |
| Manashree | Workbook inspection/adapter, slot/calendar normalization, independent expected fixtures, source register and root/CI scaffolding. | Harsh's domain/API entry points and Aaryan's app/browser commands to run the complete integration suite. |

There are four controlled handoffs, triggered by readiness rather than extra dated checkpoints:

1. **Contract agreement:** this document and contracts v1 define the interface now. H01 publishes machine-readable schema/examples without waiting for the rest of the engine. Aaryan may create frontend-local examples directly from the written contract, and Manashree may implement the declared plain-data adapter immediately. Neither needs a working backend to start.
2. **Data handoff:** Manashree produces a reviewed candidate snapshot with source references; Harsh consumes that format. Manashree does not wait for the database/API before writing the adapter, and Harsh tests validation with synthetic snapshots until the supplied snapshot is ready.
3. **API handoff:** Harsh replaces declared example responses with real authenticated endpoints; Aaryan switches each completed screen to them as available. Mock UI work is useful progress but does not count as a finished feature.
4. **Integration verification:** Manashree runs the actual root/CI checks and Aaryan runs real browser flows. All three resolve issues in their own boundaries. Integration cannot be proven using mocks, and cannot be postponed past the official feature deadlines.

Official academic documents remain a separate shared dependency, especially full award, grading and approval policies. Report missing evidence immediately and continue unaffected work. Never fill a missing rule with a fabricated one.

Avoid circular ownership: Harsh owns schemas/API/engine, Aaryan owns frontend/browser tests, Manashree owns timetable input/reference oracles/root orchestration. No shared-file editing during parallel implementation. A small change in another boundary is a documented request or separate reviewed PR.

## Checkpoint schedule

Use broad work blocks, not daily or one/two-day task deadlines. Internal readiness reviews after the implementation freeze are five days apart, on **8 and 13 November**. Required assignment dates stay fixed even when they are closer together: October 27 and November 3 are seven days apart; November 16 and 17 are consecutive official events. Do not add a November 1 or November 2 mini-checkpoint before the November 3 deadline.

| Checkpoint (IST, 2026) | Harsh | Aaryan | Manashree | Shared exit gate |
| --- | --- | --- | --- | --- |
| **27 Oct — official checkpoint; work block22-27 Oct** | H01-H09 first-release scope: contracts/SPEC, imports/review, base audit/prerequisites/planning, metrics and working CP-29 accounts/save conflicts. | A01-A07 and first-release A10 flows: requirements, import/review, accounts, record, planner and performance against real APIs. | M01-M04 initial source/timetable/oracle work; M06 commands and M07 CI/fresh-clone report. | At least17/34 green: CP-01..16 plus29; reviewed merged PRs; stranger can run from README. |
| **3 Nov — official full-feature/spec-freeze deadline; work block28 Oct-3 Nov** | Complete H10-H15: awards/joint allocation, offerings/clashes, internships, scenarios, exports, security and release integration. | Complete A08-A12: section/evidence UI, awards/internship comparisons, exports, responsive/accessibility/user fixes and real browser acceptance. | Complete M04-M10: official-source handoff, independent regressions, CI, deployment/restore and user/release evidence. | All34 green with reviewed academic data and browser evidence; production persistence works; SPEC frozen. |
| **8 Nov — internal review checkpoint** | Fix academic/backend findings and review assigned external PRs. | Fix interface/browser findings and review assigned external PRs. | Independently verify fixes and test honesty; update reproducibility evidence. | Review-window findings have owners and regression coverage; no unapproved feature expansion. |
| **13 Nov — internal demo/acceptance-readiness checkpoint** | Backup/restore and extension rehearsal; regression fixes. | Complete synthetic-data demo rehearsal and acceptance-flow readiness. | Clean-install/fallback rehearsal, evidence and demo checklist. | Tested release, backup and demo fallback ready; implementation remains extendable for the unseen request. |
| **16 Nov — official acceptance run** | Implement actual domain/API changes requested by the outsider as needed. | Implement actual requested interaction as needed. | Write/check independent acceptance evidence and full regression verification. | New SPEC statement and failing test precede code; implement/review/merge the actual unseen feature. |
| **17 Nov — official demo** | Explain academic decisions and the actual acceptance feature. | Demonstrate the student flow. | Demonstrate reproducibility/evidence and maintain fallback. | Demonstrate actual shipped behavior and process. |

The official four-session cross-group review window remains2-10 November. Attend required sessions; it is a working window, not another set of daily project checkpoints. Owners may switch within the acceptance run to match the unseen request; file boundaries remain the default.

Task cards are ordered work items inside these blocks. Their prerequisites describe what must exist before a task can finish; they do not introduce extra dated gates. Integrate slices when ready and ensure the block's acceptance criteria are met on the checkpoint date.

When a dependency slips, record the exact task/source and affected CP IDs, continue independent work, and resolve the release decision explicitly. Do not quietly delete features or count unknown-only placeholders as complete.

## Commands and definition of done

Current baseline commands remain `python -m coursepath` and `python -m unittest discover -s tests -v`; the latter currently has five intentional failures. Planned final commands after explicit README setup are `python scripts/run.py` and `python scripts/test.py`. Manashree implements them; do not document them as working before they exist.

The full test command runs existing/domain tests, Django/API/database tests, data/schema checks, frontend typecheck/unit tests/build and real browser acceptance. Support narrow selectors for development; only the full command establishes the checkpoint result. Install browser binaries and dependencies in the documented setup step, not through an unexplained runtime download.

A task is complete when its spec preceded code, expected values are independently justified, its negative case fails against an intentional defect, UI/API integration works, sources/unknowns are visible, owner and another member have reviewed it, and the PR is merged. Keep a machine-readable statement/test map and real checkpoint evidence.

## Coding-agent starting prompts

- Harsh: `Read docs/team/README.md, contracts.md, source-findings.md and harsh.md. Inspect repo state. Start the first incomplete H task, preserving existing tests and private inputs. Publish the shared schema/examples before dependent implementation. Report source blockers precisely.`
- Aaryan: `Read docs/team/README.md, contracts.md, source-findings.md and aaryan.md. Work only on the assigned frontend/browser-test boundaries. Use server academic decisions. Build to shared examples, then replace mocks with actual APIs before marking a flow complete.`
- Manashree: `Read docs/team/README.md, contracts.md, source-findings.md and manashree.md. Start with independent expected fixtures and the supplied timetable adapter. Preserve source cell provenance and unknowns. Wire run/test/CI only to real commands and report actual verification.`
