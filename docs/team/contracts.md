# Shared implementation contracts v1

These contracts are a build specification. Harsh creates machine-readable schemas/examples in H01. The written v1 contract already lets Aaryan build frontend-local synthetic examples and Manashree implement the plain-data adapter without waiting for the backend; machine-readable artifacts confirm this interface rather than start the other workstreams. No endpoint or file below is claimed to exist yet. An incompatible change needs an explicit schema version and coordinated frontend/data migration; agents must not silently change field names.

## 1. Global conventions

- Python 3.12 target; Django 5.2 supported patch release, dependency-pinned when implemented. React/TypeScript/Vite on a team-selected supported Node LTS, recorded in README and CI. No implicit dependence on the machine-specific runtime paths used for this review.
- IDs are opaque strings. A course's official code is a separate field. JSON credits are decimal strings such as `"4"` or `"1.5"`; domain uses `Decimal`, never float. Display trims unnecessary zeroes. Validate precision against supported data; never silently round imported credit amounts.
- JSON field names use snake_case. Dates are ISO `YYYY-MM-DD`; timestamps are UTC ISO with timezone. Display dates/times in Asia/Kolkata. Meeting minutes are local minutes since midnight and weekdays are integers Monday=0 through Sunday=6.
- Academic term IDs use `2026-27-I`, `2026-27-II`, `2026-27-SUMMER`. A term has chronological start/end dates, academic year and an explicit semester index for this student where known. Row ordering is not semester ordering.
- All internal date intervals are **[start_date, end_date_exclusive)**. UI accepts inclusive last day and converts once. Overlap is `a.start < b.end && b.start < a.end`. Meeting-time intervals use the same rule, so touching endpoints do not overlap.
- Absence of evidence uses `null` plus an issue/status; an empty list is not a substitute for an unknown prerequisite, missing timetable or unsupported award.
- Canonical examples are synthetic: no real name, roll number, grade history attached to an identifiable student, passwords or private source links in public CI screenshots.

## 2. Source and confidence types

`SourceReference`: `id`, `kind` (advisory/transcript/paste/timetable/course_plan/approval/student_example), `title`, `version`, `applicable_cohorts`, `effective_date` (nullable), `file_sha256` or public URL, `locator` (page/section or sheet/cell or line), `review_status` (draft/reviewed/conflicted), `authority` (institutional/student_provided/example), `retrieved_at` and `notes`.

`Issue`: `code`, `severity` (error/warning/unknown/approval_required), `message`, `entity_refs`, `source_refs`, `suggested_action`. Messages are readable; UI behavior keys off code, not English substring matching. A contradictory source is not resolved by latest file-modification timestamp.

`ApprovalEvidence`: ID, student/profile ID, policy ID, covered entities/date range, status (unsubmitted/user_reported/verified/rejected), source reference and verifier/date when verified. Students can propose or attach references; ordinary account endpoints **cannot set verified** or approve their own substitutions/credits.

## 3. Canonical records

`StudentProfile`: ID, owner derived from session, programme `BTECH_CSE`, admission year `2024`, curriculum version, selected award IDs, standing (normal/GPS/unknown), advisor cap (nullable), active/leave/restart semester metadata and approval references. Account identity does not establish academic approval.

`CourseVersion`: ID, official code, title, credits (nullable for an unresolved catalogue match), discipline, level, effective/cohort applicability, equivalence-group ID only where approved, requirement eligibility refs, prerequisite expression with a separate known/unknown flag, source refs. Attempt credits and offering credits remain separately stored.

`CourseAttempt`: ID, normalized code, original code/title/grade/credits, accepted title/grade/credits, course-version ID (nullable), term ID, completion status (completed/in_progress/failed/withdrawn/incomplete/unknown), learning designation (degree/additional/unknown), repeat/project instance ID, source refs, user corrections and approval refs. Do not assign planned status to accepted completed history.

`ImportPreview`: ID, kind (pdf/ims), record base revision, expiry, candidate attempts with cell/row issues, rejected/unparsed candidates, reported source totals, computed raw totals, performance controls, proposed identity/cohort, normalized source fingerprint and merge diff (new/unchanged/conflicting). The candidate record is not yet accepted academic history. Preserve unknown candidates for review rather than discard them.

`AcademicRecord`: profile ID, accepted attempts, confirmed current enrolment, approval refs, monotonically increasing integer revision, schema version and updated timestamp. Current enrolment can have a known section/meeting group; an old transcript does not populate it automatically.

`AcademicPlan`: ID, name, owner via session, profile/record revision, curriculum/award versions, plan revision, semesters, selected award goals and planned internship IDs. A semester item is exactly one of:

- `PlannedCourse`: ID, course-version/code reference, offering/section IDs (nullable), term ID, credits from the selected version or an explicitly unresolved estimate, intended allocation (optional), assumptions.
- `RequirementPlaceholder`: ID, requirement ID, term ID, desired credits and label. Example: 4-credit HSS elective. It contributes to **target workload** separately from selected-course workload, but cannot verify prerequisites, offerings, clashes or actual completion. It remains unresolved in a projected audit.

Represent course state as actual/completed, current/enrolled and future/planned, not as one ambiguous `done` flag. Plans through later terms remain editable even if offerings are unknown.

## 4. Academic result types and functions

Domain entry points must accept plain validated values and return serializable results. No Django ORM/querysets, HTTP requests, UI state or file-storage objects enter the domain.

Preserve and implement existing functions:

- `list_graduation_requirements(curriculum, academic_history=None)`.
- `record_course_attempts(academic_history, attempts)`.
- `explain_degree_audit(curriculum, catalogue, academic_history)`.
- `edit_semester_plan(plan, semester_id, add_courses=(), remove_course_ids=())`.
- `explain_unsatisfied_prerequisites(course_id, semester_id, catalogue, academic_history, plan)`.

Keep compatibility wrappers for the existing synthetic dict/list tests, calling the new typed engine. The wrappers are not a second independent rule implementation. Add richer service interfaces:

| Function | Input/output contract |
| --- | --- |
| `parse_pdf(file_bytes, source_ref)` / `parse_ims(text, source_ref)` | Return candidate attempts, reported controls, unparsed rows and issues; no database writes. |
| `reconcile_import(record, preview, resolutions)` | Return proposed new record and diff; idempotent for the same accepted source attempts; no mutation. |
| `evaluate_audit(curriculum, catalogue, record, plan=None, awards=(), approvals=())` | Return actual/current/projected requirement trees, joint allocation ledger and issues. |
| `calculate_performance(attempts, grading_policy)` | Return cumulative and per-term numerators/denominators, displayed values, policy completeness and source comparison. |
| `validate_plan(context, plan, offering_snapshot, calendar)` | Return ordered issue list, totals, prerequisite/availability/meeting-check status per item and conditional completion. |
| `evaluate_internship(context, internship, plan, calendar)` | Return date/attendance conflicts, proposed/verified credit allocations, module/cap issues and affected terms/courses. |
| `compare_scenario(context, baseline, scenario)` | Return independent scenario evaluation and deltas against the exact baseline revision. |

`RequirementResult`: ID, label, status (satisfied/pending/conditional/needs_review), required and counted credits/course counts where applicable, counted attempt/allocation IDs, remaining amount, excluded attempts with reasons, child requirements, source refs, assumptions/issues. Unknown requirements must not roll up as satisfied.

`Allocation`: ID, attempt/module ID, leaf requirement ID, credits, counting context (base/honours/ai_minor), shared-with allocation IDs only if allowed, source refs and explanation. A parent's aggregate is a roll-up, not an additional consumption. Degree totals sum unique degree-eligible earned credits, not every displayed requirement subtotal. Joint sharing limits count qualifying **courses** where the rule says courses, not an invented 8-credit universal limit.

`PerformanceResult`: `grade_points`, `performance_credits`, `unrounded_value` (nullable), `display_value` (nullable), source-reported value, completeness, excluded attempts/reasons and source refs, repeated for each term. P earns appropriate credits but has no performance points/denominator. Zero denominator yields unavailable, not zero CPI. E is failed for earned credit; exposure is separately policy-controlled.

`PlanValidation`: workload selected/placeholder totals, issues, per-course eligibility (eligible/ineligible/conditional/unknown), offering status, meeting-check status (`clear`/`conflicts`/`not_checked`), projected audit and completion term if justified. An unknown check cannot be flattened into clear. Earliest completion is not optimized or guaranteed by this release.

## 5. Timetable snapshot schema

`OfferingSnapshot`: ID, term ID, source refs, `coverage` (complete/partial/unknown), review status, revision/publication date (nullable), offerings, slot map, unresolved rows and issues. A source row can confirm presence in that snapshot without proving completeness or final institutional publication.

`CourseOffering`: ID, term ID, normalized display code, raw label, catalogue version match (nullable), offered credits, title, section labels, source refs, availability status (confirmed_in_snapshot/tentative/historical/unknown), meeting groups, prerequisites metadata status and classification tags as evidence candidates.

`Meeting`: ID, offering/group ID, kind (lecture/tutorial/lab/exam), weekday, start/end minutes, active date range, room (nullable), original slot, source refs. `MeetingGroup`: ID, selection semantics (all_required/choose_one/unknown), section labels and meetings/alternatives. Distinguish multiple weekly lectures from alternative lab groups. An unresolved group produces a conditional/unknown clash result.

Manashree's `build_snapshot(path, term_id, source_id)` returns this snapshot and an ingestion report without persisting it or importing Django. It reads timetable and slot sheets, not external links. Exact duplicate source rows are merged with combined provenance; conflicting rows are retained/reported. `Availability` is a consistency diagnostic. Harsh validates/imports the reviewed snapshot; Aaryan displays it. The runtime student app consumes JSON/database snapshots and does not parse XLSX on each request.

Unknown future snapshots do not inherit current-term meeting times. Future course suggestions may show a historical pattern with an explicit source/assumption, never `confirmed_in_snapshot`.

## 6. Internship contract

`InternshipScenario`: ID, duration choice (`none`/`three_months`/`six_months`), preset (`summer`/`semester`/`custom`), exact start/end-exclusive dates (null only for none), placement mode (onsite_full_time/remote_or_part_time/unknown), availability commitments, approval refs, proposed module IDs and notes. Duration choice seeds dates; actual dates are authoritative and any changed-length discrepancy is visible. Use calendar-month arithmetic, not 90/180 days; include leap/end-of-month tests.

`InternshipModule`: ID, course code IN 498 only when applicable, exact 4-credit unit, quad ID, active dates, status (proposed/registered/in_progress/completed), earned grade/status, approval ref, intended allocation to open_elective/HSS/open_project, source refs. Ordinary course attempts and exposure modules must not count the same registration twice.

Evaluation sequence:

1. `none`: no interval, no internship modules/credits. Reject stale nonempty modules when switching to none unless explicitly detached/removed in the scenario. The saved actual record is unchanged.
2. Validate dates. Presets follow D-25 (summer from 1 May for three or six months; six months from 1 July before the odd semester) and are served by `GET /calendar`; any other start is custom dates. Overlaps use only published calendar terms (D-24); later terms are reported unchecked, never invented. Show actual days and overlapping terms/quads. A label of 3/6 months is not a credit formula.
3. Onsite full-time means unavailable for overlapping required on-campus meetings; term/exam overlap without resolved section data is a warning/unknown, not silently clear. Remote/part-time still requires explicit availability and any needed permission; it does not bypass attendance requirements automatically.
4. Identify affected planned/current courses and downstream prerequisites. Report changes; do not auto-drop or auto-move courses. Let the student edit the scenario and re-run validation.
5. Validate each proposed module against an applicable policy and evidence: 4 credits/module; at most 4 credits per quad; 16 overall external-exposure credits; eligible allocation targets only; HSS max 8 and open-project max 4 under the supplied advisory; combined project/degree/award caps also apply where the reviewed policy requires.
6. Missing approval or policy means **proposed conditional credits**, not actual earned or unconditional approved projected credits. A completed approved module earns credit only with the relevant passing/completion policy. Student entry cannot elevate approval status.
7. Apply regular/summer load constraints according to the reviewed module load policy. Missing module-load/exemption policy yields an issue. Do not assume internship credit is exempt from every load limit.
8. Compare base, honours and AI-minor remaining requirements under the same shared rules. An IN 498 module cannot become an AI minor elective without explicit eligibility evidence.

The example's 12 OE+4 HSS allocation is a valid **proposal to test**, not an automatic 6-month preset credit grant. Three months can have zero credited modules; six months can have fewer than 16. Presets may suggest a proposed allocation but cannot mark it approved or earned.

`ScenarioComparison`: exact baseline record/plan/rule revisions, scenario IDs, course/term changes, unavailable windows, selected/placeholder workload, completed/proposed/approved credit deltas, unmet/unknown requirements, prerequisite/clash deltas, metrics under explicitly hypothetical grades and conditional completion-term change. Compare none/3/6 on equal baseline data. If stale, require rebase/compare before applying; never silently update the baseline.

## 7. HTTP/API contract

Prefix `/api/v1`. Same-origin session cookies and CSRF; authenticated owner comes from Django session. Public read routes reveal only reviewed non-personal curriculum/catalogue data. JSON response envelope: `{"data": ..., "issues": [], "schema_version": "1"}`. Personal responses include record/plan/rule revisions. Never log full request bodies containing transcripts/grades.

| Method / path | Payload and response |
| --- | --- |
| GET `/session` | CSRF bootstrap, `sample_student` (whether `/auth/demo` is available) and authenticated account summary `{id, username, reauth, demo?}` or null (`reauth` is `password` or `google`: how this account re-authenticates before deleting data, from whether it has a usable password; the same summary is returned by sign-up and sign-in), plus `sign_in: {google_client_id, google_domain, password}` (D-46): what the sign-in page offers. |
| POST `/auth/google` | `{credential}` (D-46). Public. Sign in with a Google ID token: accepted only for a verified `@iitgn.ac.in` address that matches Google's domain claim. 201 on a first sign-in (account created), 200 after; 401 token not accepted, 403 `NOT_IITGN_ACCOUNT` / `ACCOUNT_CONFLICT`, 429 throttled, 503 Google unreachable, 404 when no client ID is configured. While it is configured `POST /auth/signup` and `/auth/login` answer 403 `PASSWORD_SIGN_IN_DISABLED`. |
| POST `/auth/demo` | `{}` (CR-137). Public, CSRF-protected. "Try with a sample student": creates a throw-away account (own user, no password, no email) holding a made-up record of 36 attempts and signs it in; 201 with the account summary, which carries `demo: true` (real accounts omit `demo`). Its session ends after 6 hours and the account is deleted when its visitor signs out or the next sample starts after those 6 hours; at most 200 are alive at once. 409 `ALREADY_SIGNED_IN` when someone is already signed in, 429 `AUTH_THROTTLED` (30 starts per address per 15 minutes, counted apart from sign-in failures), 503 `DEMO_UNAVAILABLE` at the limit, 404 when `GET /session` says `sample_student: false` (`COURSEPATH_DEMO=0`). A sample account gets 403 `DEMO_ACCOUNT` from `/imports/preview`, `/imports/backup-preview`, `/imports/{id}/commit` and `DELETE /account/data`. |
| POST `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/password` | Django-backed account actions. Standard password validation; throttle failed attempts (sign-in, sign-up, Google sign-in and deletion re-auth share one limit per address: 10 failures in 15 minutes, then 429; successful attempts do not count, so students on one network do not lock each other out); no plaintext password persistence/logging. |
| GET `/curricula/cse-2024`, `/catalogue` | Reviewed requirements/catalogue with source and data-gap status. Catalogue supports code/title/basket/department query. |
| GET/PATCH `/record` | Return current owned record / accept validated edits with `expected_revision`. Profile/cohort remains supported. |
| POST `/imports/preview` | Multipart file for PDF or JSON `{kind:"ims", text:..., expected_revision:N}`; creates owned expiring preview, no accepted-record change. |
| POST `/imports/{id}/commit` | `{expected_revision, resolutions, accepted_candidate_ids}`; recompute/validate proposed record and commit transactionally; return new revision. Server rejects foreign/expired previews and unresolved blocking fields. |
| POST `/analysis` | `{record_revision, plan_id?, plan_revision?, award_ids}`; server loads owned state and reviewed rules. Return audit, performance and validations. No client-supplied calculated totals are trusted. |
| GET/POST `/plans`; GET/PATCH/DELETE `/plans/{id}` | Create/load/edit/delete owned plan. Mutations validate `expected_revision`; return acknowledged revision and validation. Every plan read or saved carries `status: {valid, problems, uncovered_credits}` (D-45), computed from the plan and the current record. |
| GET `/offerings?term_id=...` | Snapshot coverage/evidence, offerings, section/meeting groups and unknown state when absent. Committed official snapshots are served without a load step (D-22). |
| GET `/calendar` | Published academic calendar terms (classes, quads, exams, recess, events; end-exclusive) and D-25 internship presets; `CALENDAR_MISSING` for unpublished years. |
| POST `/plans/{id}/validate` | Evaluate persisted plan at supplied revisions, with no state change. |
| POST `/plans/check` | `{record_revision, semesters}`; D-36. Validate an unsaved plan (for example an edited draft) and report the degree credits it covers; no state change. Returns `plan_check` (see below). 409 on a stale `record_revision`. |
| POST `/plans/generate` | `{record_revision, options?}`; D-35. Build a draft plan for the remaining degree from the owner's record: no state change, nothing is saved (the client saves it through `POST /plans`). Returns `plan_generation` (see below). 409 on a stale `record_revision`. |
| GET/POST `/scenarios`; GET/PATCH/DELETE `/scenarios/{id}` | Owned isolated scenario operations, including internship choice/date/module data and baseline revisions. |
| POST `/scenarios/compare` | Compare selected owned scenarios to the exact common baseline; return table/deltas. |
| POST `/scenarios/{id}/apply-plan` | Explicit plan-only apply with expected revisions. Does not apply hypothetical grades/failures to accepted actual history. |
| GET `/export?kind=json` | Owned versioned structured backup; no password/session secrets. Print-ready report uses the analysis response and frontend print view. |
| POST `/imports/backup-preview` | Validate versioned JSON backup as a candidate; review before transactional restore through the normal commit path. This is backup restore, not general XLSX import. |
| DELETE `/account/data` | `{expected_revision, confirm: "delete my data", delete_account?, password?, google_credential?}`. Authenticated explicit confirmation and re-auth: the account's `reauth` says which: a `password` account sends its `password`; a Google-only account (D-46, no password) sends `google_credential`, a fresh Google ID token that must pass the same checks as `POST /auth/google` and name the account's own address (a password account cannot use it instead). 403 `REAUTH_FAILED`, 429 `AUTH_THROTTLED`, 503 `SIGN_IN_UNAVAILABLE` when Google is unreachable; nothing is deleted on any of them. Delete owned personal state and previews; return documented retention/backup behavior. Account/session deletion semantics must be stated in UI. |

### Plan generation (`POST /plans/generate`, D-35, CP-35)

Request `options` (all optional, unknown keys are a 400): `terms` (regular or summer term IDs, in order; default: the next regular terms after the latest term in the record or current enrolment, up to eight semesters in total), `target_credits_per_term` (default 22), `max_credits_per_term` (default and limit 28 for a regular semester, 10 for summer; D-36), `internship_term` (one of the planned terms; D-37), `skip_terms` (for example a term spent on an internship). `include_current` (boolean, default true; D-49): false plans from the completed courses alone and plans the running semester again; the response echoes it in `options`. Core (mandatory) courses keep to their year and are never delayed by missing recommended preparation, which is reported as a warning naming the missing course (D-48).

Response `data` is the `plan_generation` definition in `schemas/coursepath-v1.schema.json` (example: `examples/plan-generation.json`):

- Open-ended electives (HSS, Basic Science, CSE, open) are placeholders labelled `HSS elective`, `Basic Science elective`, `CSE elective`, `Open elective`; semesters are packed to the 28-credit limit (D-40).
- `semesters`: ready to send as the `semesters` of `POST /plans`. Courses use only fields the plan accepts (`intended_allocation` carries the requirement ID); placeholders use the existing placeholder shape.
- `placements`: one row per course or placeholder with its `requirement_id`, `basis` (`confirmed_offering` from an official snapshot, `expected_pattern` from the same-parity hint of D-23, or `student_choice` for placeholders) and a one-sentence `reason`. Show these so the student can verify each placement.
- `unmet`: every requirement the plan does not fully cover, with `reason_code` `NO_OFFERED_COURSE`, `NO_CAPACITY`, `STUDENT_CHOICE` (projects and external exposure) or `ALLOCATION_UNRESOLVED`. Nothing is dropped silently.
- `summary` (with `complete`: every requirement placed or held by something the student arranges), `assumptions`, `options` (the options actually used, including `internship_term`), `graduation` (`{internship_term, early, last_term, usual_last_term, online_credits, message}`; `last_term` may be a summer (`YYYY-YY-SUMMER`) when online courses taken in the breaks save a semester, D-41; `early` is true when the plan ends before the usual last semester, false when it does not, null when the plan could not cover every requirement; `message` is set only when early; D-40), `notice` and `validation` (the same shape as plan validation, with no `error` issue).
- The internship term holds placeholders only: `Internship module (IN 498)` (4 credits each, 16 at most) and `Online course` placeholders; their `requirement_id` names the requirement they would fill. They are proposals, never earned credit.

Placeholders may carry `online: true` (an online course the student adds or the generator proposes; D-42). Generation `options` also accept `lighten_with_online` (boolean). The response has `online_potential` (`credits_available`, `break_terms`, `busiest_semester_credits`, `busiest_before`, `lightened`) and `summary.busiest_semester_credits`.

### Plan check (`POST /plans/check`, D-36)

Body `{record_revision, semesters}` (the `semesters` of a plan, saved or not). Returns the `plan_check` definition: `validation` (as for a saved plan, but with one load rule: more than 28 credits in a regular semester is a `LOAD_LIMIT` error, with no overload path and no 20-24 guidance), `degree` (`total_credits`, `counted_credits`, `remaining_credits` covered by the plan's courses against the record), `placeholder_credits`, `uncovered_credits` (still needed after courses and placeholders), `requirements` (one row per credit-bearing requirement: `required`, `counted`, `remaining`, `held` by placeholders and `uncovered`, with its top-level `group`) `load` (per semester: `planned_credits`, `limit_credits` 28, `available_credits`) and `online` (`planned_credits`, `counted_credits` of the plan's online courses: the allocator decides how many count, D-42). When some online credits do not count the validation carries a `warning` issue `ONLINE_CREDIT_LIMIT` and `requirements[].held_credits` counts only the online credits that count, each in the requirement the allocator counts it in: above the 8-credit discipline-elective cap (ADV13 p. 15, D-10), or aimed at a requirement online courses cannot fill (D-42), an online credit holds open-elective credit, not the requirement it was aimed at. It saves nothing, is owner-scoped and revision-checked (409 when `record_revision` is stale).

`workload[term]` in every plan validation (D-50): `selected_credits`, `enrolled_credits`, `placeholder_credits`, `online_credits` and `target_credits`. `online_credits` is optional: it is present only in a draft check (`simple_load`, D-36) of a regular semester that holds online courses, and states up to 16 credits that are outside the load, so `target_credits` (the number the 28-credit limit is applied to) leaves them out. It is absent in a summer break, where the online credits are part of `target_credits` against the break's 10-credit limit, and in a saved plan, which keeps the ADV13 p. 7 load rules and counts online credits like any other. `placeholder_credits` still includes every placeholder, online ones too.

### Degree totals (`audit.degree`)

`POST /analysis` returns `audit.degree.{actual,current,projected}` as `{total_credits, counted_credits, remaining_credits}`: the degree total (170 for CSE 2024), the credits counted toward it (each requirement counts at most what it asks for) and the credits left. The UI shows these numbers and never computes them.

### Later terms (`GET /offerings`, D-38)

A semester the institute has not published returns the carried-forward timetable of the same semester (`derived_from` names the source term; meetings are the same slots with active dates moved by whole years), up to five years after the latest official one.

Top-level `issues` are generation issues only (`REQUIREMENT_UNMET`, `warning`). The server never places a course in a term whose complete official snapshot lacks it, never invents a course for a requirement that nothing offered fills, and returns the same result for the same input.

Use HTTP 400 invalid payload, 401 unauthenticated, 403 CSRF/forbidden action, 404 missing or foreign-owned object (avoid leaking existence), 409 stale revision, 413 file limit, 422 semantically uncommittable import and 429 throttled account requests. Use stable codes such as `UNMATCHED_COURSE`, `EQUIVALENCE_UNCONFIRMED`, `IMPORT_TOTAL_MISMATCH`, `SOURCE_CONFLICT`, `PREREQUISITE_MISSING`, `OFFERING_UNKNOWN`, `MEETINGS_UNKNOWN`, `TIMETABLE_CONFLICT`, `INTERNSHIP_ATTENDANCE_CONFLICT`, `INTERNSHIP_APPROVAL_REQUIRED`, `QUAD_CREDIT_CAP`, `ALLOCATION_UNRESOLVED`, `REVISION_CONFLICT`.

Autosave: debounce edits, send expected revision, keep unsynced draft until success, show saving/saved/error/conflict. Avoid parallel mutation races by serializing saves per resource or coalescing queued edits. A 409 does not trigger unconditional overwrite/retry. GET requests and analysis should not mutate academic records.

## 8. Shared test artifacts and integration rules

Harsh writes `schemas/coursepath-v1.schema.json` plus `examples/{empty-record,import-preview,audit,plan-validation,internship-comparison,revision-conflict}.json`. Manashree supplies independent expected source fixtures under `tests/reference_fixtures/`; Aaryan consumes public synthetic examples for mock development. Validate both against the shared schema.

Existing five tests remain under `tests/`. Harsh's new domain tests use `tests/domain/`, parser tests `tests/imports/`; Django tests live in the relevant `server/` app. Manashree's independent regression suite uses `tests/reference/` and timetable tests `tests/data_sources/`. Aaryan owns `frontend/src/**/*.test.*` and `e2e/`.

The root runner must discover nested tests reliably; use package markers or explicit discovery locations and assert that the known test sets were actually executed. Passing because a nested directory was skipped is a defect. Statement-to-test mapping names actual test IDs, not just files. CP status is derived from outcomes and reviewed/user evidence; do not hardcode a passing count.

Local setup creates dependencies/database and installs browser engines explicitly. Local run needs no external credentials. Hosted deployment uses environment-configured secrets and a shared persistent PostgreSQL database. Tests must exercise production database behavior in CI/staging before release; local SQLite success alone does not establish hosted persistence.
