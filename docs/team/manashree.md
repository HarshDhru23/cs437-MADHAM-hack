# Manashree implementation tasks

Read [team instructions](README.md), [contracts](contracts.md), [source findings](source-findings.md) and the roadmap's official-data checklist. Own the timetable source adapter, calendar/timetable snapshots, source/ambiguity register, independent expected fixtures/tests, root scripts/CI and operating/user/demo documentation. Harsh owns approved academic policies/domain algorithms and Django; Aaryan owns frontend/browser tests.

Task numbering is the implementation order inside the shared checkpoint blocks, not a daily schedule. Start independent owned tasks immediately; use readiness handoffs in the team README. The first-release deadline is27 October, full-feature freeze3 November, internal reviews8 and13 November, then official acceptance/demo16-17 November.

## M01. Source register and independent sample oracles — first-release block (27 Oct)

Files: `docs/data/source-register.md`, `docs/data/ambiguities.md`, `tests/reference_fixtures/`, `tests/reference/`, plus `data/source-manifest.json` schema coordinated with Harsh.

1. Inventory the advisory, transcript, IMS text, supplied timetable, example graduation plan and any later documents. Record source ID/title, file hash or approved URL, authority, applicable cohort/term, effective/revision date or explicit unknown, exact page/sheet/cell and review state. Do not use download/modified time as institutional effective date.
2. Preserve originals; do not save the XLSX after reading it just to inspect data. Reading libraries may warn about unsupported Excel validation extensions; no source rewrite is authorized. Add only reviewed non-personal datasets/fixtures to Git, not a raw real student's transcript/plan/IMS record.
3. Build independent expected JSON for anonymized PDF/IMS fixtures. Controls: PDF39 rows, terms10/10/10/9 and credits28/22/28/26, raw104; IMS40 rows and28/23/28/26, raw105; both the sample record's performance credits, points and CPI. Preserve two CS299 instances and ES242(N). Expected values must be checked from sources, never copied from Harsh's parser output.
4. Build a synthetic example-plan fixture preserving the academic structure but not real student identity. Keep28/24/16 future totals,68 overall,66 remaining, CS202 after CS203, CS421 mismatch and explicit requirement placeholders. Proposed internship allocation is12OE+4HSS, with no invented approvals/dates.
5. Record unresolved rules: CS203/202, CS421/431, project instance/caps, SC372 classification, CPI/SPI exceptional attempts, AI minor/CSE honours lists, module approval/load policy, viva semantics and future term evidence.

Checks: source locators exist; expected JSON matches independently reviewed counts/sums; no names/roll numbers/private links/passwords in committed fixtures/screenshots. Give Harsh expected records and ambiguity IDs; give Aaryan public synthetic example responses after schema validation; Aaryan can independently create frontend-local synthetic examples from contracts while these fixtures are prepared.

## M02. Timetable XLSX adapter and source report — first-release block (27 Oct)

Owned files: `coursepath/data_sources/timetable_xlsx.py`, `scripts/build_timetable.py`, `tests/data_sources/test_timetable_xlsx.py`, reviewed outputs under `data/offerings/` and `data/calendars/`. Depend on `openpyxl` only for read-only ingestion, with the dependency addition coordinated through Harsh. Runtime application consumes normalized snapshots, not arbitrary student-uploaded spreadsheets.

Public adapter: `build_snapshot(path, term_id, source_id) -> (snapshot, ingestion_report)` matching contracts. No Django imports, persistence, academic allocation, automatic external-link requests or mutation of the source file.

Detailed steps:

1. Open workbook read-only/data-value mode where compatible, retaining separate hyperlink/notes access if needed. Verify required sheets/headers by normalized text; preserve original sheet names for locators. Recognize `Time table`, `Time Slots` and `Availability` exactly in the supplied workbook; report missing/renamed unsupported structures.
2. Read the header mapping: A code, B title, C/D/E contact L/T/P, F academic credits, J sections, K/L/M lecture/tutorial/lab, N course-plan link, O preferred knowledge, P remarks, Q minor hints, R HSS/BS hints. Do not confuse contact hours with credits. Preserve source cells for every emitted field.
3. Skip fully empty/formatted rows and recognize section/header rows. Retain unrecognized course-looking rows in report rather than silently discard. The observed control is330 pattern-matching course rows/301 distinct literal labels; use a diagnostic, not a magic expected count for every revised workbook.
4. Parse `Time Slots!A1:F8` into weekday/minute intervals. Thirty teaching slots are present. Normalize Unicode dashes/whitespace; exclude Lunch Break. Parse row time labels into start/end, validate end>start and map each populated slot token through its column weekday. Missing/duplicate/conflicting slot definitions become issues.
5. Parse K/L/M cell text into raw slot tokens and room/delivery notes. Use the slot dictionary to resolve tokens; do not parse room numbers as slots. Multiple weekly lectures are required meetings; multiple lab/tutorial alternatives may be ambiguous. Preserve all raw data and use `selection_semantics=unknown` if section meaning cannot be established; do not invent section-room pairings.
6. Normalize basic code spacing only. Preserve suffix/topic/co-list/section text and catalogue match status; distinguish `(N)` from offering language/section annotations. Some codes appear in multiple departmental/year blocks. Merge exact duplicate normalized offerings/meeting sets with combined provenance; retain different section/credit/meeting variants and flag genuine conflicts.
7. Extract actual hyperlink target when present and retain cell locator; display text such as 'CS301:OS' is not proof of an approved equivalent code. No link gets fetched or promoted into a hard prerequisite automatically. Supplied O/Q metadata is empty in matched rows: report unavailable, not no prerequisites/no eligible minor.
8. Source classification tags are evidence candidates, not final graduation/award membership. Do not infer every BS-tagged course is in the narrower science basket or every CS course is a CSE elective.
9. `Availability` validates course/room/slot consistency without emitting duplicate offerings. Flag discrepancies for review; it must not override a course row silently. An online note does not remove a scheduled time commitment.
10. Output deterministic sorted JSON with schema/source/snapshot IDs, supplied term, coverage/review/publication status, offerings/meeting groups, slot map and unresolved rows/issues. Keep current snapshot term-specific. A file named2026-27 does not populate later terms.

CLI: `python scripts/build_timetable.py --input <path> --term 2026-27-I --output <draft.json> --report <report.json>`. Validate schema before writing; draft remains unreviewed until Harsh's rule/data review. Never commit student data or machine-specific absolute source paths as runtime configuration.

Tests: synthetic minimal workbook; actual source inspection controls when supplied locally; F-vs-L/T/P credits,30 slot map, B1 Tuesday08:30/H2 Wednesday11:30, row27/110 CS202 dedup, conflicting same-code variants, language suffix, blank formatted1000rows, missing sheet/unknown slot, multimeeting lecture, unknown lab alternatives and empty O/Q. Return all errors in report rather than crashing on one row. Hand off draft/source report when ready in the first-release block, no later than27 Oct.

## M03. Graduation example and timetable regression oracle — first-release block (27 Oct)

Files: independent `tests/reference/test_example_plan.py`, `test_sample_reconciliation.py`, documented expected cases. This task creates tests/reference data, not a public graduation-XLSX importer.

- Independently sum semester5=28, semester6=24, internship proposal16; total68 versus summary remaining66. Explain surplus2 without asserting the plan is invalid or fully graduating.
- Source summary104/170 is a reported student allocation; do not treat its12 discipline-elective credits or20 core credits as official truth. Finer theory/systems and approval rules must come from the advisory.
- Map sample PH202/ES667 lectures B1/B2 and PH202/CS331 tutorials H2 from actual timetable/slot cells. Give expected weekday/minute overlaps and source refs to Harsh/Aaryan. Respect active date/section assumptions in tests.
- Source `XX XXX` rows become explicit unresolved requirement placeholders; they never pass prerequisites/offering/clash checks as actual courses. CourseCS421 is not auto-renamedCS431.
- Test historical ES112 credit3 versus current offering4 remains separate. A selected current course cannot alter old transcript performance totals.
- Test zero-credit PE/viva still have obligation state. A summary zero remaining **credits** is not proof that every obligation is complete.
- Preserve the internship description as proposed12OE+4HSS only. No official approval/module calendar is present in the source workbook.

Expected fixtures must not import the engine under test to calculate expected answers. Run against Harsh's public services when available and report disagreements using source cells/pages. Do not edit his tests/logic to force agreement.

## M04. Calendar and official metadata handoff — first-release coverage27 Oct; complete coverage3 Nov

Files: `data/calendars/2026-27.json`, source/ambiguity register, reviewed offering snapshots, `docs/data/data-gaps.md`. Harsh reviews approved academic/award data; this task collects/checks evidence and prepares candidates.

1. Use the official academic calendar for regular/summer terms, teaching/quad boundaries, recess, examination/registration windows. Verify exact dates from the current dated source; do not copy a prior year's summer or infer a term's full teaching interval from internship month labels. Preserve date uncertainties explicitly.
2. Distinguish teaching, recess, exams and term administrative dates. Do not assume all courses meet across every date/quad. If no course-specific active range is known, record the assumption/unknown rather than manufacture first/second-half membership from a2-credit value.
3. Request/collect the missing official documents through the team: full AI minor/CSE honours rules; course prerequisites and approved substitutions; repeat/grade policies; project and external-exposure/module/load approvals. Do not send messages externally without the human's authorization or use portal credentials.
4. Table each gap with affected CP/task IDs, source sought, needed date, actual status and decision owner. Provide source evidence before the affected feature is accepted: first-release cases by27 Oct and remaining supported cases by3 Nov. Missing evidence is reported immediately rather than held until a checkpoint.
5. Course-plan links in workbook can help discovery, but a blank preferred-knowledge field says nothing about actual prerequisites. Read a full applicable approved source before proposing a structured hard rule; distinguish faculty preference/consent from a prerequisite.
6. Track SemesterII and later offerings independently. Unknown future data stays unknown; historical term patterns may be offered only as sourced assumptions. No current slot is copied forward as confirmed.
7. For internships, obtain how IN498 modules map to quads, who approves allocations/remote study and whether/how they count toward summer load. Advisory caps alone cannot determine credited modules from calendar months.

Exit: data-gap report is actionable and truthful. Missing official policy remains a release blocker for the affected supported feature; a generic unknown component is not counted as completed analysis.

## M05. Independent adversarial/regression tests — first-release coverage27 Oct; complete coverage3 Nov

Files: `tests/reference/`, `tests/reference_fixtures/`, `tests/data_sources/`. Coordinate interface changes with Harsh; do not add a second academic engine in test helpers.

Build independently justified cases for:

- Every imported valid row retained; malformed candidate visible; same source imported twice does not double credits; separate project instances remain separate; corrupt import never damages accepted record.
- Failed/in-progress/planned not earned; P excluded from performance denominator; E failed but exposure only where approved; zero denominator unavailable; weighted SPI; current offering credits do not replace historical attempt credits.
- Narrow science basket plus flexible BS elective allocation, theory/systems inside CSE total, combined online+project cap8 and source-supported project/exposure caps; mandatory missing despite enough total credits.
- Same/later-term prerequisite fails, earlier planned pass conditional, unknown prerequisite distinct from none, AND/OR/co-requisite truth tables.
- Course/section clash evidence, lab/tutorial included, exact duplicates deduped, adjacent intervals clear, different quad dates clear, missing/ambiguous group not checked, future unknown not clear.
- Honours+AI minor permitted joint sharing and excluded base-core reuse, subject to obtained official policy. Do not invent an AI minor course list to satisfy the deadline.
- None/3/6 internships: no automatic credit; summer-only versus term overlap; exact dates/leap/month end; 4-per-quad and16overall caps; HSS8/open-project4; stale modules after switching to none; proposed approval cannot become verified; actual baseline unchanged.
- Two accounts cannot read/edit/export/delete one another; stale revision cannot overwrite a newer save; scenario hypothetical failure cannot enter real history through plan apply; backup restore validates schema/version and previews changes.

Use a small, temporary intentional defect to check important tests detect the promised wrong behavior, then revert it before submission. Example: deliberately include P in CPI or ignore tutorial meetings. Document actual result; do not add permanently passing self-referential checks or suppress failures with skips/xfails merely to obtain green.

## M06. One run command and one test command — first-release block (27 Oct)

Files: root `scripts/run.py`, `scripts/test.py`, README setup/run/test sections and `.env.example` descriptions coordinated with Harsh. Harsh owns backend dependency versions/settings; Aaryan owns frontend package commands/lockfile.

Local setup must list supported Python/Node versions, virtualenv and package installation, frontend `npm ci`, Django migrations, browser-engine installation and optional synthetic seed. Explain the first run versus normal run. Generate/store a development secret only in ignored local configuration. No external account or production secret is required to try the SQLite local app.

`python scripts/run.py`:

1. Validate installed prerequisites and clear missing-setup messages. Do not silently install dependencies or browser binaries during every run.
2. Start Django API on localhost8000 and Vite on localhost5173 with agreed dev proxy/CSRF configuration; allow documented port overrides. Check readiness, print the user-facing URL and keep both subprocess outputs readable.
3. Handle Windows and POSIX process cleanup on Ctrl+C/error, close child servers, propagate failure and avoid leaking background processes. Never open visible helper windows by default.
4. Support production-like/local build mode only after the real backend/static build exists; do not claim Django devserver is the hosted production server.

`python scripts/test.py`:

1. Run existing unittest tests and nested domain/import/reference/timetable discovery, plus Django/API tests. Explicitly ensure nested packages/tests are discovered.
2. Validate schemas/examples/reviewed data. Run frontend typecheck/unit tests/build using Aaryan's actual scripts.
3. Start an isolated test server/database with synthetic data and run the actual Playwright suite. Clean up on all exit paths. Production/private records are never used.
4. Print per-suite results and exit nonzero for **any** required failure. Support documented narrow selectors for development, but the default full command runs everything.
5. Produce a statement/test-result mapping and expose unimplemented/missing tests. Do not count a statement passing because only one of several required tests passed or because discovery skipped its directory.

Before features are implemented, tests are expected to be red; do not alter the runner to return success for these failures. The original scaffold command can remain as a compatibility entry, but README must make the web run command obvious.

## M07. CI and October27 evidence — first-release block (27 Oct)

Files: `.github/workflows/ci.yml`, `docs/submissions/2026-10-27.md`, statement/test mapping/report tool under `scripts/`. Do not modify the historical October9 record to imply new work existed then.

CI on PR/push checks Python/domain/API, data schema, frontend typecheck/unit/build and browser acceptance. Use a disposable PostgreSQL service for production-type database tests, isolated generated test secrets and no private inputs. Cache dependencies using lockfiles; test migrations. Frontend/browser artifacts contain synthetic data only.

Map each CP ID to actual named tests and user-flow evidence; show tests-green separately from reviewed-merged/submission-complete evidence. All required tests for a statement must pass. Include unresolved official data/status, actual commit and reviewed PR links, not invented counts/review approvals.

October27 target: CP01..16 plus29,17/34. Independently follow README from a fresh checkout/environment, create a new synthetic account, import, inspect audit, edit/save plan and open on a second context. Report any missing setup step and fix docs/scripts. Obtain another member's review of your PR and review the assigned other's actual work.

## M08. Deployment/runbook/backup rehearsal — full-feature block (3 Nov)

Files: `docs/operations/runbook.md`, deployment checklist, non-secret environment guide and backup/restore instructions; coordinate code/config changes through Harsh.

Document chosen actual host/URL, same-origin app/API/static serving, persistent PostgreSQL, required environment names, production secret provisioning, allowed hosts, HTTPS/cookies, migrations, production server, health/readiness and error handling. Do not assume a free-tier instance's local disk persists. No production secrets enter Git or CI artifacts.

Run production-type migrations and Django checks with Harsh; verify sign-in/save/second-device reload and app restart persistence. Back up the database, restore into a separate test environment, compare synthetic record/plan revisions and clean up test resources safely. State retention/account deletion behavior including backups accurately.

Provide local synthetic fallback for demo/acceptance connectivity problems, with a tested normal-run path. This is not evidence that hosted cross-device persistence works; that requires the real shared-server test.

## M09. User-test session and demo script — user verification3 Nov; demo-readiness review13 Nov

Files: `docs/qa/user-test-script.md`, actual observation notes, `docs/demo.md` and known-limitations list. Arrange real sessions through the humans; do not fabricate quotations or contact users automatically.

Ask Aayush and another student to: browse requirements without history; import/review a record; explain one counted/remaining requirement from its source; add/move a course; understand the PH202/ES667 clash; compare no/3/6-month internship credit/availability effects; find AI-minor progress; save and reopen on another context. Observe assistance/time/confusion. The two-minute first-audit goal is measured, not a pre-written success claim.

Demo order: public requirements -> synthetic PDF or paste -> review source discrepancy -> audit/source -> current-term clash -> full-degree tentative future -> CPI/SPI -> honours/AI-minor -> three internship scenarios -> cross-device save -> actual acceptance feature after16 Nov. Show the second input method briefly or keep it as a second prepared flow. Never display a real student's identifying record publicly by default.

## M10. November3 freeze and acceptance evidence — freeze3 Nov; reviews8 and13 Nov; official events16-17 Nov

Prepare the actual34-statement/test/user-evidence report by3 Nov. A missing dataset or all-unknown award page is reported as incomplete, not green. Verify the tagged/merged release on3 Nov, participate in cross-group reviews2-10 Nov and re-run relevant independent tests after fixes.

On16 Nov capture the outsider's actual new feature request, ensure a new SPEC statement/failing acceptance test precedes code, independently verify the implementation and run full regression. Do not pre-invent what the unseen feature will be. On17 Nov report actual behavior/process/contributions and keep the tested fallback available.

## Handoff format

For each completed M task provide source IDs/locators, schema/data filenames, unresolved decisions, independent expected values, actual commands/results, reviewed merge status and next consumer. Harsh needs candidate snapshots and academic ambiguities; Aaryan needs meeting/issue examples and usable source labels. Never paste a private full transcript or credentials into shared logs.
