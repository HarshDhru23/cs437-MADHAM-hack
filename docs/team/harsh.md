# Harsh implementation tasks

Read [team instructions](README.md), [contracts](contracts.md), [source findings](source-findings.md) and the academic rules/source register before starting. Own `coursepath` domain/import/rule modules, Django `server`, canonical schemas/examples and approved academic datasets. Leave timetable ingestion, root orchestration/CI and frontend files with their named owners.

Suggested PR units are the H task IDs below, each with SPEC IDs and failing tests first. Preserve existing five test contracts using thin compatibility wrappers. Do not submit empty endpoints as finished features or change test expectations to fit placeholder output.

Task numbering is the implementation order inside the shared checkpoint blocks, not a daily schedule. Start independent owned tasks immediately; use readiness handoffs in the team README. The first-release deadline is27 October, full-feature freeze3 November, internal reviews8 and13 November, then official acceptance/demo16-17 November.

## H01. Specification, schema and domain skeleton — first-release block (27 Oct)

Files: `SPEC.md`, `schemas/coursepath-v1.schema.json`, `examples/*.json`, `coursepath/models.py`, `coursepath/issues.py`, `coursepath/serialization.py`, package markers for nested tests; backend dependency manifest and version lock.

1. Add CP-06..34 to SPEC using the roadmap's exact behavior and keep the named user/quote. Preserve CP-01..05. Split broad acceptance tests into parameterized cases while maintaining explicit ID mappings.
2. Define immutable domain dataclasses/typed structures from contracts. Treat all input as untrusted; validate numeric/date/status/version fields. Decimal credit values serialize to strings. Create stable issue codes and ownership-free domain functions.
3. Define source, academic attempt, term, requirement expression, allocation, award, offering/meeting group, plan, scenario and internship representations. Missing prerequisite/meeting data is distinguishable from a verified empty list.
4. Publish synthetic JSON examples for an empty record, 39/40-row import summary, unresolved equivalence, partial audit, course clash, three internship cases and a revision conflict. No real identifying headers in examples.
5. Add failing behavioral tests for the spec additions before implementing the corresponding feature. Review machine schema against examples and the frontend owner's needs; freeze v1 names before dependent work starts.

Checks: existing test discovery still finds five tests; new tests fail for promised behavior, not import errors; schema tests reject unknown enum values, invalid dates and negative credits; examples round-trip decimals exactly. Hand off schema/examples and SPEC IDs to Aaryan and Manashree as the first completed slice; they can start their owned work from the written contracts without waiting for the engine.

## H02. Django/accounts/persistence foundations — first-release block (27 Oct)

Files: `server/manage.py`, configuration, `accounts/`, `records/`, `plans/`, `api/`, ORM migrations and app tests. Use Django's standard password/session APIs and CSRF protection. Same-origin production; Vite dev proxy for frontend.

1. Create signup/login/logout/session/password-change actions, password validation and login throttling using a maintained Django integration or a tested cache/database limiter. Never implement password hashing yourself. No IMS sign-in or institutional identity claim.
2. Create owned profile, record, attempt, import preview, plan, scenario and approval-evidence models. Use explicit foreign keys/indexes, decimal fields, source refs, validated structured rule payloads and integer revisions. Do not uniquely constrain a course code per student.
3. Keep reviewed public catalogue/rule snapshots immutable by version. Staff ingestion/review commands are separate from student endpoints; students cannot set approval status to verified.
4. Implement a local development configuration with SQLite and a generated ignored local secret; production uses environment secrets and PostgreSQL. Migrations run through a documented explicit setup path. Do not write real credentials or private records to `.env.example`.
5. Add every owned lookup through an owner-filtered service/query; return 404 for foreign-owned object IDs. Protect preview/plan/scenario/export/approval paths, not just the dashboard.
6. Implement transactional revision checks for record/plan/scenario mutations. Update only when stored revision equals expected revision; otherwise 409 with current revision and a reload/compare instruction. Use conditional update or locking correctly on both SQLite and PostgreSQL.
7. Persist through process restart. Provide synthetic development data creation; do not create a production default password or seed a real student's record.

Tests: signup duplicate/invalid input, bad password, CSRF missing, unauthenticated calls, session/logout invalidation, two-user read/edit/export isolation, invalid approval escalation, two-device conflicting updates and actual database persistence. Account recovery email is a separately configured deployment capability; never display a reset action that cannot deliver recovery.

Acceptance: CP-29 works end to end by 27 Oct, including real save/reload/409 behavior. Supply Aaryan working session/save endpoints when the corresponding slice is ready in the first-release block, no later than27 Oct. Coordinate database setup/deploy variables with Manashree.

## H03. Transcript PDF adapter — first-release block (27 Oct)

Files: `coursepath/imports/pdf_transcript.py`, `pdf_layout.py`, parser tests under `tests/imports/`; dependencies `pdfplumber` and `pypdf`.

1. Validate actual file signature/readability, configurable size/page limits and bounded processing. Handle malformed/encrypted/image-only PDFs with useful errors and the paste/manual fallback. Temporary files expire and are deleted on every exit path. Do not execute embedded content or send student PDFs to an LLM.
2. Detect institutional/programme and academic-period anchors. Read programme/admission year as candidates, never overwrite the selected supported cohort without review. Parse reported earned/performance credits, points and CPI separately from rows.
3. Use coordinates: identify left/right columns and semester-block bounds from headings. Read each block independently; group code/title/credit/grade cells by y coordinate; join wrapped titles only inside the same block. Repeated hidden headers/legend/footer lines are not course attempts.
4. Handle continuation pages with inherited block term only when evidence is unambiguous. Reject/flag unknown layouts instead of silently dropping rows. Preserve raw code `(N)` and decimal credit values, zero-credit PE/viva and separate CS 299 registrations.
5. Return candidate rows with page/block/line/box provenance, normalized term, raw grade and all unparsed course-looking candidates. Parsing does not decide official basket equivalence.

Independent fixture controls: 39 attempts, chronological term counts 10/10/10/9, term credits 28/22/28/26, total 104, performance credits 92, points 849, CPI 9.23. Original sample stays local; use anonymized/synthetic-layout committed fixtures agreed with Manashree. Include title wrapping, shifted spacing, extra page/repeated header, missing grade, duplicate text layers and corrupted file tests.

Acceptance: CP-06,09,10,12,13. Adapter does not mutate records; parse totals cannot be made correct by discarding a row. Give Aaryan a real preview endpoint/response for the sample when the corresponding slice is ready in the first-release block, no later than27 Oct.

## H04. IMS paste and shared normalization — first-release block (27 Oct)

Files: `coursepath/imports/ims.py`, `normalization.py`, `grades.py`, parser tests.

1. Recognize the five actual headers and tab-separated structure. Support CRLF/Unicode spaces and bounded whitespace/multiline copy variations. Do not split titles on normal spaces or conflate credit and grade columns.
2. Parse academic year/semester I/II/summer into canonical terms. Sort by academic chronology only for display; preserve original order/source line. Retain rejected/unparsed candidate lines and duplicate source rows for review.
3. Normalize `CS202`/`CS 202` spacing and Unicode hyphens; preserve `(N)`, topic suffixes and unresolved section/language labels. Course identity/equivalence matching is a separate reviewed-data step.
4. Grade map: letter passing through D, E/F failed, P completed but performance-excluded; blank/unknown symbols remain reviewable. An E exposure rule belongs to prerequisite evaluation. Current enrolment must be confirmed separately.
5. Use one canonical normalization/grade layer for PDF and paste; keep independent adapter extraction tests to avoid a shared bug hiding format differences.

Tests: sample 40 attempts/105 raw credits/92 performance credits/849 points; SC 372 preserved but classification unresolved; two CS 299 attempts retained; ES 242(N) unchanged; whitespace/line break/ampersand/zero-credit/missing-header/missing-field/unknown-grade/large-input cases. A malformed row must appear in issues, not disappear from the record without disclosure.

Acceptance: CP-07,10,14. No guessed graduation allocation during parsing.

## H05. Preview, correction and atomic import commit — first-release block (27 Oct)

Files: `coursepath/imports/reconcile.py`, owned import services/API/ORM tests. Implement contract routes for preview, commit and record edits.

1. Persist an owned expiring preview with base record revision and raw/normalized candidate provenance. Keep original PDF only transiently; structured preview text must receive the same access protection as grades.
2. Build diff against existing attempts by stable source identity plus reviewed term/instance metadata; do not deduplicate every course code. Conflicting grade/credit/title edits require explicit resolution. Detect same-source re-import idempotently, including a changed row order.
3. Allow corrections with raw-to-accepted field history. Correcting extracted `CS 203` to `CS 202` is not a silent equivalence approval; require an actual correction justification and preserve evidence. Official substitutions remain approval-governed.
4. Validate all accepted rows, unresolved blocking credit/term/grade fields, supported cohort, preview ownership/expiry and expected record revision. Recompute server-side totals, normalize, then transactionally commit once. A failed commit leaves old history/revision intact.
5. Add confirmed current-enrolment/section editing, clearly separate from completed history. A student can save an unmatched course but receives a reviewable audit rather than fabricated eligibility.

Tests: preview produces no accepted mutation; edit→commit→reload; total mismatch; unchanged/conflicting re-import; two same-code project instances; correction survives re-import; stale revision/expired/foreign preview; database failure rolls back; temporary files cleaned up. CP-02,08,09,11,12,13.

## H06. Reviewed rule and catalogue datasets — first-release block (27 Oct)

Files: `data/curricula/cse-2024.json`, `data/catalogue/`, `data/grading/`, later `data/awards/`; `coursepath/rules/schema.py`, `loader.py`, `sources.py`.

1. Use the main roadmap's exact advisory sections and Manashree's source inventory. Enter rules with page/clause, applicability, effective date and review state. Validate source references and unresolved conflicts at load time.
2. Encode the 170-credit baseline with institute core 31, materials 3, HSS 28 (GE included), maths 10, science basket 8 plus separate BS elective 4, CSE core 36, CSE electives 26 (8 theory+8 systems inside), OE16, open project4, foundation4. Preserve per-semester PE/viva obligations independent of credit totals.
3. Course lists must include CSE-applicable cross-department options. Science-basket membership is narrower than BS-elective eligibility; do not add discipline requirements from another branch to CSE.
4. Keep CS 203/202 and CS 421/431 unresolved; preserve ES 242(N). Historical transcript credits are authoritative evidence of that reported attempt, not overwritten by today's catalogue/offering. Unknown course identity blocks only the affected decision, with visible partial analysis.
5. Add sourced caps for projects/online/exposure and any approvals. Distinguish advisory guidance, mandatory limits and student-specific conditions. Catalogue prerequisites absent from approved data remain unknown.
6. Implement review/validation tools that reject bad/cohort-inapplicable data; students cannot upload a replacement curriculum that silently becomes institutional authority. Keep a staff-reviewed source version when applying a correction.

Tests: total reconciliation, duplicate/conflicting rule IDs, missing page/source, wrong cohort, impossible basket minima, core/elective distinction, GE not counted outside HSS, zero-credit obligations retained and no fallback to invented course prefixes. CP-01,03,13,19,20. Request missing source decisions before the dependent academic feature is accepted; do not fabricate them.

## H07. Explainable base audit and credit allocation — first-release block (27 Oct)

Files: `coursepath/rules/expressions.py`, `allocation.py`, `degree_audit.py`, domain tests.

1. Implement typed mandatory, all/any, course-count, min-credit, approved-set and cap rules. Required amount and satisfaction are separate from course presentation. Count only completed/eligible attempts in actual view; current/planned statuses stay separate.
2. Assign verified mandatory matches first, then allocate flexible completed courses among eligible leaf baskets. Use deterministic bounded branch-and-bound: most constrained attempt/requirement first, stable IDs as tie-breakers, prune credit/cap-impossible branches, memoize equivalent remaining-capacity states. Keep a concrete node/time budget configurable and tested; budget exhaustion yields `ALLOCATION_UNRESOLVED`, not false graduation eligibility or a claim of impossibility.
3. Prefer a full valid assignment when one exists; for incomplete records use a documented stable objective prioritizing mandatory obligations then reducing deficits without consuming a unique narrow-basket option for an unrestricted basket. Test alternatives where greedy first-match fails. Allocation decisions and exclusions must be inspectable.
4. Allocate each indivisible course instance only once across exclusive base leaf baskets. Split only explicitly separable units/modules where policy permits it. Parent theory/systems totals roll into CSE elective total; they do not consume another 16 credits. Degree total counts unique earned eligible credits.
5. Apply project/online/exposure constraints while allocating, not as a cosmetic subtraction after the UI already marks requirements complete. Unknown cap interaction remains conditional with source refs. Do not assume every 1-credit course is short-course excluded.
6. Return a requirement tree plus full ledger, deficits, excluded courses and reasons. Evaluate actual/current/projected independently; unknown prerequisites/approvals/unresolved placeholders prevent unconditional projected completion.

Tests: existing CP-03; independent complete/incomplete datasets; failed/in-progress/planned exclusion; distinct project attempts; same source dedup; overlapping science/BS elective choice; narrow-basket adversary; parent/degree conservation; zero-credit failed/recorded obligations per policy; exact/over/under cap; deterministic result order; exhausted-search honest unknown. CP-03,17,18,19,20. Performance target: ordinary supported records should evaluate interactively; measure and document rather than skipping allocation work.

## H08. Prerequisites and semester plan — first-release block (27 Oct)

Files: `coursepath/prerequisites.py`, `semester_plan.py`, `eligibility.py`, plan API/services and tests.

1. Preserve existing CP-04/05 wrappers; add add/remove/move actions, stable planned-item IDs and chronological terms. Recompute Decimal selected-course totals and separate unresolved-placeholder target totals.
2. Implement nested AND/OR expressions with proof of satisfied branches and smallest meaningful unmet alternatives. Same/later-term planned prerequisites do not count; an earlier planned pass is conditional only. Check co-requisite and E exposure only under an explicit applicable rule.
3. Reject or explain duplicate selected course instances, already completed non-repeatable courses and unsupported repeats; approved repeatable/project instances remain possible. Unknown identity/prerequisite policy is visible, not automatically eligible.
4. Apply normal guidance 20-24, hard/advisor cap28, GPS21, summer10 and conditional overload up to32 under the stated CPI and approval conditions. Never approve overload just because CPI>=7.
5. Validate downstream courses after every move/drop; return issue entity IDs and sources so UI can highlight them. No course is auto-moved. Term/course capacity or consent restriction is enforced only from actual evidence; enrolment counts alone do not prove the student has a seat.

Tests: existing matrix, nested expression truth tables, unknown vs empty, completed E vs pass/exposure, same/earlier/later terms, all load boundaries, approval exceptions, placeholders, failed prerequisites and duplicate/repeat distinctions. CP-04,05,21,22.

## H09. CPI/SPI — first-release block (27 Oct)

Files: `coursepath/performance.py`, grading policy schema/data and domain/API tests.

Use Decimal points/credits; reproduce 849/92→9.23. Points: A+11,A10,A-9,B8,B-7,C6,C-5,D4,E2,F0; P excluded. Display source-reported and recalculated values distinctly. CPI cap10 follows source; SPI cap/rounding/repeat/withdrawal behavior must come from evaluation policy, not inference. Unknown repeat/substitution inclusion prevents a verified recalculation for affected records. Never discard a failed attempt from performance solely because it earns no credits.

Return per-term and cumulative contributing attempts/numerators/denominators, exclusions, policy/source and incomplete status; no denominator yields unavailable. Hypothetical scenario grades stay separately labeled and do not predict actual grades. Tests: independently calculated term SPI, weighted versus unweighted mean, P/zero-credit exclusion, E/F denominator, A+ and CPI cap, rounding boundaries, repeated project vs retake and unknown special grade. CP-14,15,16.

## H10. Honours/AI minor and joint allocation — withdrawn 3 Nov (D-18)

Files: `coursepath/awards.py`, award data and shared allocation extensions.

Obtain full current source documents applicable to 2024 CSE. Encode eligibility, mandatory/alternative courses, additional-credit amount, projects, approved electives, base-core exclusions and joint sharing. Do not approve the AI minor from a generic '20 credits' rule alone. Use the shared allocator; represent permitted sharing explicitly, applying the combined limit on two qualifying base open-elective courses across honours/minor claims. More future minors load through the same schema without rewriting evaluation.

Separate eligibility-to-pursue, earned progress and projected completion. Show remaining approved options with offering/prerequisite caveats. Tests: mandatory AI course absent, base core wrongly reused, allowed/excess sharing, project cap, honours required parent-discipline project, joint allocation consuming a unique course, unknown rule list and future minor definition loaded through same engine. CP-25,26,27. Hand off concrete response fixtures to Aaryan; do not let frontend invent award math.

## H11. Offering and timetable validation — full-feature block (3 Nov)

Files: `coursepath/offerings.py`, `timetable.py`, staff reviewed-snapshot import and APIs. Consume Manashree's adapter output through the shared schema; do not duplicate XLSX parsing.

Apply snapshot term/coverage/review status. A present entry confirms only that snapshot; absence in partial coverage is unknown. Keep current supplied timetable separate from future historical hints. Resolve selected lecture/tutorial/lab meeting groups; an unknown alternative group makes the check conditional. Compare actual weekday/time/date overlap; rooms do not remove student conflicts. Deduplicate identical source offerings/meetings without erasing distinct sections.

Tests: PH202/ES667 B1,B2 lectures, PH202/CS331 H2 tutorials, adjacent endpoints, different quad/half dates, alternative sections, unknown group, duplicate source rows, multiple meetings, absent future timetable, changed credits across terms. CP-23,24. Emit related meeting/course IDs and precise source cells for Aaryan's explanation panel.

## H12. Internship calendar, availability and credit modules — full-feature block (3 Nov)

Files: `coursepath/internships.py`, `calendar.py`, scenario/plan model extensions and tests.

Implement the exact sequence in contracts section 6. Provide none/3/6 month choices; summer and semester presets; exact date editing with actual duration; inclusive UI/end-exclusive engine conversion; calendar-month arithmetic including leap/end-of-month behavior. Presets fail helpfully if official term/quad dates are missing.

Compute actual affected teaching/exam periods and selected required meetings. Full-time onsite blocks overlapping campus requirements; remote/part-time requires explicit commitments/permissions. Produce affected/downstream-course issues without mutating/removing courses. Do not block an entire regular semester for a summer-only internship.

Persist proposed versus verified IN498 modules separately, at 4 credits each and one module/4 credits per quad, at most16 overall. Validate HSS8/open-project4 caps, allowed targets, repeated module IDs and other cap interactions. Student entries are never self-verified. No duration-only grant: six months with no approval/modules has zero earned/approved credit; the example's 12OE+4HSS is conditional. Do not count internship credits toward AI minor unless an actual rule says so; missing load exemption stays unknown.

Tests: none leaves baseline unchanged; summer3 overlaps only actual dates; six months spanning semester7 flags required teaching/exams; partial-term dates; leap/month-end; start=end/invalid/reversed input; missing calendar; same quad two modules;17+/cap violations; HSS>8/open-project>4; proposed vs completed/approved; foreign approval; course/module duplicate registration; 3months≠8credits;6months≠16credits. CP-33,34. Publish comparison fixture before Aaryan finishes scenario UI.

## H13. What-if comparison, plan apply, exports/restore — full-feature block (3 Nov)

Files: `coursepath/scenarios.py`, scenario API, export/backup service/tests.

Clone validated baseline at exact record/plan/rule revisions. Support drop/fail/postpone/replace/cap and award/internship choices. Re-run the same engine, emit deltas and conditional completion terms. Compare none/3/6 on the same baseline; stale scenario requires rebase/review. No automatic optimal graduation claim; extended horizons are user choices.

Explicit apply writes only selected future plan edits after revision checks; hypothetical failure/grade edits cannot enter actual history through this action. JSON export includes schema/rule/source versions and owned record/plans/scenarios but excludes credentials/session data. Restore validates version, ownership and schema, previews diff and commits only on confirmation; never execute code from a backup. Print report consumes the authoritative analysis response.

Tests: unchanged baseline object/deep checksum, all operations, downstream prerequisite changes, hypothetical CPI labeled, scenario saved/reloaded, stale rebase/apply conflict, no actual-grade write, JSON round-trip and unknown schema/error rollback. CP-28,30,33.

## H14. Privacy and deployment hardening — full-feature block (3 Nov)

Complete all object ownership/re-auth/deletion/temp-cleanup flows. Add input time/resource bounds, safe error/logging paths and secure deployment settings. Backups retain data only under the documented retention policy; deletion UI must not claim immediate erasure of every backup if that is untrue. Do not expose debugging tracebacks or private uploaded files through static paths.

Prepare production PostgreSQL settings/migrations and production server/static build integration. Run Django deploy checks, HTTPS/cookie/CSRF tests, owner isolation, failed-save rollback and process-restart persistence with Manashree. Keep a tested backup/restore path. CP-29,32; no hosted default user/password. Hosting deployment requires the team's actual environment and configured secrets; report that dependency explicitly.

## H15. Release integration — full-feature block (3 Nov)

Integrate all three workstreams against actual APIs/data; keep CP map honest. Resolve independent-oracle conflicts through source evidence, not by changing expected values to current output. The supplied sample must expose unresolved CS202, selected-course clashes and internship credit conditions rather than falsely label graduation complete.

By 3 Nov: all 31 statements passing (CP-25 to CP-27 withdrawn, D-18) with real browser evidence, approved required data, fresh-clone commands, production persistence and source traceability. Review another member's changes and obtain another member's review of yours; merge/tag only through the required process. On 3 Nov freeze SPEC at what actually works. Do not certify an award or exceptional grade policy whose source never arrived.

## Handoff checklist after each PR

List task/CP IDs, changed domain/schema/API names, migration effects, source versions/ambiguities, exact tests/outcomes, actual reviewed merge status and next dependencies. Aaryan needs stable example/error shapes; Manashree needs real command entry points, required environment names and independent reproducible outputs. Do not include private grades/passwords in handoff logs.
