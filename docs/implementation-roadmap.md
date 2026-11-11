# CoursePath implementation plan

Prepared 22 October 2026 (IST). Product scope confirmed with the team; academic-data dependencies below remain open. This is a planning deliverable, not a claim that the features exist.

**Execution entry point:** [Team implementation instructions](team/README.md). Read that file, the [shared contracts](team/contracts.md), and the named teammate's task file before coding. Those instructions contain the 34-statement checkpoint target, named ownership and internship acceptance cases. They are the execution entry point for the workstreams below.

Confirmed follow-up decisions: plan the full remaining degree with evidence labels; offer no internship, 3-month and 6-month scenarios with exact dates and summer/semester presets; keep CS 203/CS 202 unresolved; support CSE honours and AI minor only; use accounts with cross-device saving.

## 1. Agreed scope and release boundary

Build an account-based web application for **IITGN B.Tech CSE, 2024-entry students**. A student can inspect official requirements, import a transcript PDF or IMS grade-table paste, verify the extracted record, audit graduation progress, plan semesters, check prerequisites/offerings/timetable clashes, inspect CPI/SPI, track CSE honours and an **AI minor**, and compare what-if scenarios. Records and plans follow the student's account across devices.

Keep curricula, minor definitions, grading rules, course identities, offerings and timetables versioned and separate from application code. Future minors and batches should be additions to reviewed data, with tests, rather than changes to the audit algorithm.

Automatic plan generation, natural-language chat, live IMS integration, other admission batches, other minors, dual majors/degrees, and grade prediction are outside this submission. Manual scenario editing is in scope. Account sign-in is for CoursePath; it does not assert IITGN identity or require IMS credentials.

The earlier root `Plan.md` and `SPEC.md` described manual entry first and transcript import later. This plan supersedes that sequencing: **both imports are essential to the release**. Preserve manual correction and current-enrolment entry as supporting features. Do not silently rewrite historical submission evidence.

## 2. Verified repository baseline

- `coursepath/` contains five placeholder domain functions. There is no academic implementation, parser, catalogue, rule dataset, web UI, authentication, database, dependency manifest or CI configuration yet.
- `SPEC.md` contains CP-01 through CP-05. All five corresponding unittest tests run and fail as intended; they use synthetic data. `python -m coursepath` successfully prints scaffold status.
- Local history includes merge commit `824d4c8`, for PR #1. The October 9 submission note's claim that the remote has no commits is historical and must not be used as current status.
- The supplied PDFs, IMS text and reference/submission documents are currently untracked. The root `Plan.md` is ignored by `.gitignore`; this roadmap deliberately uses a different tracked-file-compatible name.
- Branch protection, instructor access and each member's reviewed/merged contribution have not been independently verified in this review.

The October 16 checkpoint requires at least ten statements with a test each. The present local state has five; record this as a recovery task, without backdating work or assuming there was no separate submission elsewhere.

## 3. Sources and interpretation rules

Use these local documents as primary evidence:

1. [Hackathon reference](reference/hackathon-2026-10-09.html), checkpoint table and rules, especially spec/test/review requirements.
2. [January 2026 B.Tech norms](../Adv13_Norms%20for%20BTech%20Programme_28%20Jan%202026.pdf): institute rules pp. 1-4; honours/minors p. 6; academic load p. 7; duration/credit expiry pp. 8-9; science/math baskets p. 10; CSE rules pp. 14-15; 2024-entry CSE sample p. 23. Other departments' degree structures are outside scope; their courses remain eligible where a CSE-applicable rule permits them.
3. Sample transcript (a private local PDF, never committed), including its evaluation legend on p. 2.
4. [IMS sample](../copied_input.txt).
5. [Supplied current timetable](../Timetable%2C%20Sem-I%2C%202026-27.xlsx): `Time table`, `Time Slots` and `Availability` sheets. Unlike the earlier public tentative course list, this workbook contains meeting slots and their weekday/time legend. Treat it as a supplied term snapshot, with revision/finality recorded rather than assumed.
6. Example graduation plan (a private local workbook, never committed): example student intent and reconciliation cases, not an academic rule authority or an automatically accepted record.

Public sources checked on 22 October:

- [CSE B.Tech overview](https://cse.iitgn.ac.in/academics/btech/) and [CSE catalogue](https://cse.iitgn.ac.in/academics/courses/): discovery and catalogue evidence; a catalogue entry alone does not establish a cohort equivalence or term offering.
- [Institute course catalogue](https://iitgn.ac.in/academics/courses): additional course descriptions and credit variants. It lists CS 202 and CS 203 separately; no equivalence was established by this review.
- [Institute curriculum overview](https://iitgn.ac.in/academics/btech-curriculum): secondary summary; do not use its generic cohort text to override the supplied dated advisory.
- [2026-27 tentative course list](https://iitgn.ac.in/assets/pdfs/Timetable26-27.pdf): despite its filename, this is a tentative list of course titles, not a day/time/section timetable.
- [2026-27 academic calendar](https://iitgn.ac.in/academics/calendar/acadcal-2026-27): term and quad boundaries. It currently places academic pre-registration on 2-6 November; use a current dated snapshot when building.
- A [CSE/AI minor document](https://cs.iitgn.ac.in/Minor_Dual_Major%20in%20CSE_AI.pdf) was discoverable in search, but direct retrieval failed. Obtain the full current document before approving AI minor rules; a search excerpt is insufficient.

Every approved rule needs source ID, exact page/section, applicable cohort, effective date, version and review status. Store short rule descriptions and structured logic, not an unreviewed PDF scrape. Maintain an ambiguity register. When sources conflict, preserve both claims, identify the applicable authority/date, and obtain clarification. Never silently resolve a conflict by title similarity or document order.

### 3.1 CSE 2024 baseline to encode and review

| Requirement | Evidence / implementation consequence |
| --- | --- |
| Total | CSE 2022-24 sample p. 23 states **170 credits**. Reconcile this with the structured component totals and approved exceptions. |
| Institute core | The nine courses in clause A.16 total 31 credits; materials basket adds 3. Keep the materials choice distinct from those mandatory courses. |
| HSS | **28 credits**, including HS 191 (2), HS 192 (2), Economics (4), Philosophy (4), World Civilizations (4), and remaining 12 including **two 2-credit GE courses**. GE is inside the HSS total. |
| Mathematics | MA 103 (4), MA 104 (2), MA 203 (2), plus 2 credits from the approved math basket. |
| Science | 8 credits from the approved science basket **plus a further 4 BS-elective credits**. Science-basket courses may fill the BS-elective allocation, but the same credit cannot satisfy both separate allocations. Annexure I imposes no named science-course requirement specifically on CSE. |
| CSE core | Nine 4-credit requirements: DSA I, Discrete Mathematics, Digital Systems, Computer Organization, Theory of Computing, Operating Systems, Software Tools for CSE, Foundations of AI, Computer Networks. p. 23 uses ES 242, ES 214, ES 204, ES 336, CS 201, CS 330, CS 202, CS 329, CS 331 respectively. Confirm course versions/equivalences before import matching. |
| CSE electives | **26 credits total**, including at least **8 theory/algorithms** and **8 systems**. These sub-baskets contribute to the 26-credit parent requirement; they are not extra degree credits. p. 23 illustrates the remaining 10 as general CSE electives. |
| Open electives | 16 credits; approved courses from other departments may qualify. Do not implement as a list of CS codes. |
| Project / foundation | Open project 4 credits after first year; foundation 4 credits or the approved alternative where applicable. Repeated project registrations need attempt identities and approved allocation rules. |
| Non-credit obligations | Four PE semesters. Comprehensive viva is required for every active semester; p. 4 says a **Pass or Fail grade** is mandatory. Do not replace that wording with an unsupported blanket rule requiring P in every viva. Seek clarification on the intended completion semantics. |
| Special caps | p. 15 caps **online courses and CS projects together** at 8 discipline-elective credits. p. 7 caps project credits toward graduation at 16. Clarify interaction with p. 2 wording about projects in addition to the open project. |
| External exposure | Approved IN 498 modules have a 16-credit total cap, 4 per quad, allowed allocation only to open electives/open project/HSS, with respective limits in A.12 (including HSS max 8 and open project max 4). Obtain the detailed advisory before handling real exposure records. |
| Duration | 2024 entrants fall under the 2023-onward duration policy: eight-year credit expiry and extension-request conditions. Use active-semester and course-date metadata, not a universal 12-semester cutoff. |

The listed components reconcile to 170: 31 + 3 + 28 + 10 + 12 + 36 + 26 + 16 + 4 + 4. This is a baseline before any approved substitutions, honours/minor sharing, exposure or other exceptions.

CSE cross-disciplinary elective examples explicitly listed on p. 15 include ES 335, ES 404, ES 615, ES 627, ES 637, ES 645, ES 659, ES 661, ES 666, ES 667, ES 669, ES 670 and ES 676. Theory basket: ES 301, CS 614, CS 617, CS 328. Systems basket: CS 327, CS 332, CS 431, CS 432, CS 434, CS 435, CS 615, CS 616, ES 668. Confirm current additions and course versions; do not infer that every course owned by CSE is an elective, since mandatory courses must not count twice.

### 3.2 Important unresolved academic details

> **Update 29 Oct 2026:** most items below are now decided in [Academic decisions](academic-decisions.md), which takes precedence over this section and the related parts of §5 (see its "Superseded text").

- The sample has **CS 203**, while the CSE core lists **CS 202**. Keep CS 203 as imported; do not mark the CS 202 requirement complete without an approved substitution/equivalence.
- Preserve **ES 242(N)**. The public catalogue distinguishes credit variants; removing the suffix and substituting another version's credits would corrupt the audit.
- **CS 299 occurs in two semesters**. These are separate reported registrations, not duplicate import rows. Whether both count, and toward which requirements, needs project policy/evidence.
- The paste has **SC 372, 1 credit** absent from the academic transcript. p. 7 excludes one-credit short-course credits from graduation, but verify this course's actual classification. Do not classify every 1-credit course by its credit value alone.
- p. 6 permits 2022-onward honours/minor credit sharing subject to conditions. Two qualifying base open electives may count toward additional requirements, with a **joint** sharing limit across combined awards. This is not permission to share independently twice for every minor/honours path. Obtain the current AI minor and CSE honours lists and interaction policy.
- The 2025-onward prose says CSE discipline electives are 30 credits, while p. 31's sample depicts 32 (16 basket + 16 other). This does not affect the selected 2024 release, but blocks blindly adding later cohorts.
- Student-specific approvals, GPS status, faculty-advisor load limits, active semesters, restarts, expired credits and additional-learning designation may not be present in either import. Ask for them only where relevant; missing evidence must produce an explicit unknown/approval-required state.

## 4. Input pipeline: the first implementation priority

Both adapters feed the same canonical academic record:

`PDF or IMS paste -> extraction -> normalized candidate attempts -> catalogue/rule matching -> reconciliation -> student review -> atomic commit -> all analyses`

No import writes directly into the accepted record. Keep the previous record intact if extraction or saving fails.

### 4.1 PDF adapter

Use `pdfplumber` for coordinate-aware words/tables, with `pypdf` for metadata/text checks. The supplied PDF is text-based. Page 1 has four independent semester blocks, in two columns; page 2 contains the bilingual evaluation legend. Whole-page text extraction interleaves columns and duplicates some hidden headers, so a flat regex is insufficient.

Detect semester headings and column boundaries from coordinates; crop each block; group rows by code/credit/grade columns; join wrapped title lines within their block. Handle continuation pages and repeated headers. Extract programme/cohort, reported totals, performance credits, cumulative points and CPI separately from course rows. Use the legend for grade evidence, never as course rows. A prototype crop inspection found all four blocks with 10, 10, 10 and 9 course rows.

Do not claim arbitrary scanned-PDF support. Detect absent text, encrypted/corrupt files or an unrecognized layout and offer IMS paste/manual entry. OCR can be added as a separately tested adapter later. Suggested initial limits: 10 MB, 20 pages, bounded extraction time; document and test the chosen limits. Do not execute embedded PDF content or use an LLM to decide grades/rules.

### 4.2 IMS paste adapter

Parse the actual header fields: Academic Period, Course No, Course Name, Credit, Grade. Prefer tab-separated rows; support the browser's whitespace/multiline variants using course/term/grade anchors, without splitting a title on ordinary spaces. Normalize Unicode spaces, CRLF, case and dash variants while keeping raw text. Accept valid zero-credit rows and ampersands; preserve suffixes such as `(N)`. Report every unparsed candidate row with its line reference.

Map terms into explicit academic year, I/II/summer and calendar dates. The paste is reverse chronological; do not use input row order as semester order. Blank grade is not a passing grade and does not by itself establish current enrolment. Current registered courses need a separate user-confirmed input because these samples end in May/June 2026.

### 4.3 Canonical model and review

Each attempt carries: stable ID; original and normalized course code; catalogue version/match status; title; exact decimal credits; term; raw grade; derived completion status; learning designation; repeat/project instance metadata; source ID and page/line; user correction history; approval references where needed.

Keep completion status, prerequisite exposure and performance participation separate. Grade E is failed for earned credit, but the transcript says it *can* count as prerequisite exposure; evaluate only under the particular prerequisite's approved policy. Grade P can earn credits without entering CPI. Unknown symbols require review; do not convert them to F. PLANNED belongs to a plan, not to completed history.

Preview shows semester groups, row counts, credit totals, unmatched courses and flagged cells, with original evidence on demand. Students can edit extraction errors or omit a row, then explicitly accept the import. Correcting a transcription error does not approve an academic equivalence. Re-import produces a diff (new/unchanged/updated/removed) and the new import replaces the rows an earlier import saved (changed rows keep their identity and a re-import entry in their history; a row the new import repeats unchanged keeps the student's correction); rows the student typed in are never replaced, and a changed one still needs a decision. Deduplicate the same source attempt, never all occurrences of a course code.

### 4.4 Sample acceptance evidence

| Check | Expected result from supplied sources |
| --- | --- |
| Transcript attempts | **39**, across four semesters, with credit sums **28, 22, 28, 26** in chronological order. |
| Transcript reported earned credits | **104**. Preserve reported value and compare to extracted rows; do not automatically call all 104 allocated graduation credits. |
| IMS attempts | **40**, term credit sums **28, 23, 28, 26**; raw credits **105**. |
| Difference | Extra SC 372 in 2024-25 semester II; flag/classify rather than failing the parser or forcing totals equal. |
| Repeated course | Preserve two CS 299 registrations, one in each 2025-26 semester. |
| Variant | Preserve ES 242(N), 4 credits. |
| Performance reconciliation | The sample record's performance credits, grade points and CPI (controls kept local with the sample): reproduced from the graded rows using the transcript legend, excluding P. |
| Non-credit rows | Preserve all PE and IN entries. |

Commit only anonymized fixtures with synthetic identity/header values. Use the supplied real transcript for local verification; do not publish it as a CI artifact or a demo account's record. Keep independent expected JSON so tests cannot use the parser's own output as the oracle.

## 5. Academic engine and analyses

### Rule model and allocation

Implement mandatory-course, all/any-of, minimum-credit, course-count, approved-set, maximum-cap, per-term/quad, grade/exposure and approval-required rules as typed data. Requirement trees explicitly distinguish a parent's subtotal from disjoint sibling allocations. Degree totals count each eligible earned credit once.

Evaluate **actual completed**, **completed plus current enrolment**, and **projected plan** separately. A plan can be conditionally complete without the actual degree being complete. Requirements use satisfied / pending / conditional / needs-review; validation issues use error / warning / unknown / approval-required with stable reason codes and source references.

Use a deterministic allocation strategy with constrained-course priorities and bounded search/backtracking where baskets overlap. Do not use naive first-match greedy allocation: a flexible elective can otherwise consume the only course eligible for a narrow basket. Produce a ledger of course-attempt credits allocated to requirements, parent roll-ups, exclusions and caps. Check conservation and allowed sharing. For base/honours/AI-minor combinations, evaluate the **joint** allocation rather than adding three independent audits.

Every result explains required amount, counted attempts/credits, excluded attempts and why, remaining work, source and uncertainty. A student-provided approval is visibly distinguished from a reviewed institutional rule. Incomplete rule data cannot yield an unconditional completion verdict.

### Prerequisites and semester plans

Support course / AND / OR / nested expressions, minimum-grade/exposure and co-requisites where verified. Earlier completed courses satisfy historical checks; earlier planned courses satisfy only projected checks contingent on passing. Same-term prerequisites do not count unless an explicit co-requisite policy allows it. Unknown prerequisite data is not equivalent to no prerequisites.

Maintain chronological semester objects with add/remove/move actions, exact credit totals and duplicate detection. Revalidate prerequisites downstream after every change. Regular load: normal 20-24 guidance, maximum 28 unless a lower advisor cap applies; GPS max 21; overload up to 32 is conditional on the stated CPI/recommendation/approval conditions; summer max 10 (p. 7). A CPI threshold alone does not grant approval. Model approved exceptions explicitly; distinguish guidance from enforced limits.

### Offerings and timetable

Version offering data by term with confirmed / tentative / historical-pattern / unknown status. Absence from a tentative or incomplete list does not prove a course is unavailable. Historical odd/even patterns are planning hints, not confirmed future offerings.

Meeting data needs course version, section, lecture/tutorial/lab type, weekday, start/end, date/quad range and required/alternative groups. A clash requires an overlapping day, time interval and active date range for required selected meetings. Adjacent endpoints do not clash; first-half and second-half courses in the same slot need not clash. Missing slots show **Not checked**, never **No clashes**. Section choice is part of planning.

### CPI and SPI

Use the transcript's points map: A+=11, A=10, A-=9, B=8, B-=7, C=6, C-=5, D=4, E=2, F=0; D is the minimum pass. P has no performance contribution. The transcript states a CPI maximum of 10. Store exact numerator/denominator, round only for display and reproduce the sample reconciliation above.

SPI is term-specific weighted performance; CPI is cumulative under the official attempt inclusion/replacement policy. Obtain the evaluation/repeat/substitution advisory before deciding how failed/repeated/substituted attempts, withdrawals, incomplete grades, thesis and additional learning affect either denominator. Report source CPI separately from recalculated CPI if policy information is missing. Do not advertise a fully verified SPI formula for exceptional attempts before obtaining the policy; do not assume CPI's stated cap necessarily defines all SPI handling.

### CSE honours and AI minor

**Withdrawn from this release on 3 Nov** (`docs/academic-decisions.md` D-18): CP-25 to CP-27 are no longer SPEC statements. The text below is kept as background for a later release.

For the selected cohort, p. 6 provides a general 20-additional-credit framework and a parent-discipline project requirement for honours, with qualifying open-elective sharing. It is not a complete approved course list. Encode CSE honours and AI minor as separate versioned award definitions using the common engine, including mandatory courses, approved electives, project limits, eligibility restrictions and permitted overlap.

Show eligibility to pursue, progress toward requirements and projected completion as separate outcomes. A CSE student's completed base core cannot be reused for an AI-minor requirement that explicitly excludes base-programme requirements. Do not assume a listed CSE minor is a valid additional minor for a CSE student. Support only the AI minor at release; add future minors through the same schema, validation and source-review process.

### What-if scenarios

Create a versioned clone of the accepted history and plan. Support dropping, failing, postponing or replacing a course, changing a future credit cap and comparing honours/AI-minor goals. Re-run the same audit, metrics, prerequisites, offerings and clashes; show the delta and downstream affected courses. Hypothetical grades and CPI/SPI are explicitly labeled assumptions. Do not mutate the real record or present an earliest-graduation prediction as guaranteed without confirmed future offerings. Applying a scenario to a saved plan is a separate explicit action; hypothetical failures never overwrite actual grades.

Offer three first-class internship choices: **none**, **3 months**, **6 months**. Summer/semester presets seed exact dates; students can adjust the dates and inspect actual duration. Date ranges, attendance/unavailability and approved academic credit are independent data. Use actual calendar/quad overlaps, exam periods where available, and required course meetings to detect conflicts. A summer internship does not automatically block an entire regular semester. A semester-spanning internship must expose affected courses and downstream prerequisites; do not silently move them or assume a remote/online waiver.

Internship duration does not itself award credits. Represent proposed/approved IN 498 modules separately, applying the official 4-credit-per-quad limit, 16-credit external-exposure limit and permitted allocation/caps. The example's six-month placement proposes 12 open-elective plus 4 HSS credits; retain that as a scenario assumption until approval and module dates are verified. Do not infer 8 credits from three months or 16 from six months. Show no-internship versus both duration scenarios side by side, including schedule conflicts, earned/projected allocations, remaining degree/award requirements and evidence-dependent completion term.

The supplied example plans 28 credits in semester 5, 24 in semester 6 and 16 internship credits in semester 7: 68 future credits versus 66 remaining in its basket summary. Display 2 additional planned credits without treating excess as inherently invalid. Its PH 202 and ES 667 use B1/B2 lectures in the supplied timetable; PH 202 and CS 331 also share H2 tutorial slots. These are mandatory regression examples subject to actual date/section applicability. The spreadsheet schedules CS 202 separately after CS 203; that supports leaving them separate, but is not an official equivalence decision. Preserve the unresolved status already agreed.

## 6. UI brief and user verification

Mode: task-focused academic tool. The intended outcome is a student who can identify remaining requirements and explain the result without opening code. The strongest visual element is the readable relationship between **requirement, counted courses and source**, not decorative charts.

Proposed visual direction: warm neutral background, high-contrast dark text, restrained deep blue/teal accent, one readable sans-serif family, consistent spacing and tabular numerals. Green/amber/red states always have text/icon labels. This is a proposed direction; lock actual tokens and representative desktop/mobile screens before full UI implementation. Avoid a marketing-heavy opening, dense unexplained graphs and decorative animation.

### Main flow

1. **Explore requirements** without sign-in: show CSE 2024 curriculum, full grouped requirements and a clear `Add my record` action. Keep this view available throughout the app.
2. **Import**: equal `Upload transcript PDF` / `Paste IMS grades` tabs; brief instructions, sample input with synthetic identity, visible privacy note and parser limitations. Sign-in is required before saving personal data; preserve the local draft through sign-in.
3. **Review**: `Import -> Review -> Analyze` progress; semester tables, issues first, source preview, editable cells and `Confirm record`. Example: `40 rows found; 1 short-course classification needs review`. Never silently fix academic differences.
4. **Overview / requirements**: completed credits, degree-allocated credits, remaining work, outstanding questions and current CPI. Expandable basket rows show mandatory courses, progress and explanations. A completed/current/planned control clearly changes which state is being inspected.
5. **Planner**: semester table with searchable course picker, credit totals, eligibility/basket/offering labels, add/move/remove and undo. Clicking an issue highlights its course and gives a concrete remedy. Desktop can show a validation side panel; mobile uses a focused semester view.
6. **Performance and awards**: CPI/SPI table with calculation details, honours and AI-minor requirement trees, joint-sharing explanation and remaining approved options.
7. **Scenarios**: obvious scenario banner and baseline comparison, changed courses/credits, downstream issues and explicit plan-apply action.
8. **Account**: save state, saved plans/scenarios, export, change password, sign out and delete personal data.

Keep three main navigation areas: `Requirements`, `My record`, `Plan`; performance, awards and scenarios are discoverable within record/plan rather than competing first-run tasks. Search courses by code/title/department/basket. Do not make drag-and-drop the only way to move a course. Show save progress and failures; offline edits remain an unsynced draft and do not appear saved across devices.

Implement empty/loading/partial/error/unknown states, keyboard focus, screen-reader labels, sufficient contrast, reduced motion and touch targets. Desktop tables retain real headers; mobile semester switching and detail sheets avoid making the whole page horizontally scroll. Verify 390px, tablet and 1440px layouts, keyboard-only import/planning and 200% zoom.

Usability gates with Aayush and at least one student outside the team: identify a remaining requirement and its source; import without assistance; resolve one flagged row; add a course and understand a prerequisite/clash warning; compare a scenario and return to baseline. Target a first audit in about two minutes for a clean supported input, excluding sign-up and document retrieval; measure rather than claiming it in advance. Record observed issues, not invented feedback.

## 7. Architecture and persistence

Recommended stack: **React + TypeScript + Vite** frontend; **Django** backend with built-in authentication/sessions, JSON endpoints and ORM; existing pure-Python `coursepath` academic package; `pdfplumber`/`pypdf` imports; SQLite for reproducible local development and PostgreSQL for hosted multi-user persistence. Pin supported versions and lock dependencies at implementation. Django is a recommendation chosen for account/persistence delivery; the older FastAPI suggestion was not an implemented constraint.

[Django authentication](https://docs.djangoproject.com/en/5.2/topics/auth/default/) supplies password/session primitives. Follow the [deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/) for the hosted setup. This avoids building custom password hashing or JWT storage. Keep the SPA/API same-origin in production and use a Vite proxy locally. No SSR, microservices, Redis or background queue is needed initially.

```text
frontend/                         screens, components, typed API client
server/                           Django config, accounts, API, persistence
coursepath/                       pure domain; no Django/browser imports
  imports/                        PDF and IMS adapters, normalization
  rules/                          typed expressions and allocation
  degree_audit.py                 base + joint awards explanations
  prerequisites.py                eligibility and ordering
  semester_plan.py                editing and validation
  performance.py                  CPI/SPI policies
  scenarios.py                    isolated changes and deltas
data/                             reviewed versioned JSON + source manifest
tests/                            domain/parser/integration fixtures
frontend/tests/                   components and browser acceptance
scripts/                          one run / one test orchestration
docs/                             roadmap, ambiguities, data dictionary, QA
```

Preserve the existing public function boundaries where practical. Tests should drive their implementation; do not replace the existing tests merely to obtain green output. Define shared example request/response JSON first so UI, domain and persistence can progress independently.

### Main records

- CurriculumVersion, CourseVersion, CourseEquivalence, RequirementDefinition, AwardDefinition and SourceReference.
- Term, CourseOffering, Section, Meeting and offering-snapshot completeness metadata.
- User/Profile with selected cohort, confirmed academic standing and relevant approvals.
- ImportBatch with provenance, proposed rows, review decisions and expiry; CourseAttempt with a stable instance identity.
- AcademicPlan, PlannedSemester, PlannedCourse, Scenario, ApprovalEvidence and record/plan revisions.

Store credits as exact decimals. Use foreign keys and owner/term indexes; keep schema migrations. Immutable reviewed rule versions may use validated JSON; identity, ownership and attempt relations remain explicit. Do not make `(user, course_code)` unique: legitimate repeated project registrations would be lost. Restrict true source-attempt duplicates using stable source identity and reviewed term/instance keys.

Suggested API groups: public curriculum/catalogue; signup/login/logout/password change; import preview/commit; academic record; audit/performance/awards; plans/validation; offerings/sections; scenarios/compare; account export/delete. Responses include stable IDs, issue codes, sources, rule version and record revision. Keep frontend calculations presentational; the server returns authoritative totals.

All personal queries scope by the authenticated owner, including imports, exports and object lookups; never trust a user ID in submitted JSON. Use session cookies, CSRF protection, standard password validators, login throttling and HTTPS in production. Test two-account access isolation. Staff rule-data editing is distinct from student record editing.

Save imports/plan edits transactionally with optimistic revision checks. A stale second-device edit gets a conflict and reload/compare choices, not a silent overwrite. Autosave shows the acknowledged server revision. Include a real two-browser-context persistence test and a database restart/restore check.

Do not retain original PDFs by default: extract/review in bounded temporary storage and remove on completion/expiry/failure. Store the accepted structured record and minimal provenance. Keep grades/identifiers out of access logs and analytics. Provide account-data export/deletion, encrypted transport, restricted database access and backup/restore procedures; document backup retention for deleted data. Public demos use synthetic accounts. Obtain a hosting environment, domain/URL and secret configuration before release; no production passwords/keys enter Git.

## 8. Proposed specification and acceptance map

Expand `SPEC.md` **before feature code**, with at least one independently meaningful automated test for every statement. Preserve CP-01..05 IDs; define additions below as proposed user-observable contracts. Do not claim they are already implemented or tested. Split test cases further where needed rather than making each statement a single happy-path assertion.

| ID | Checkable statement | Primary evidence/test |
| --- | --- | --- |
| CP-01 | A student can inspect all CSE 2024 requirements grouped by basket before supplying history. | Existing test + requirements browser flow and approved-data completeness. |
| CP-02 | A student can record/correct completed, in-progress and failed course attempts without losing prior attempts. | Existing test + edit/commit integration. |
| CP-03 | A student can inspect counted completed courses/credits and remaining requirements. | Existing test + independently hand-audited record. |
| CP-04 | A student can add/remove/move future courses and see semester credit totals. | Existing test + browser planner workflow. |
| CP-05 | A student can see which prerequisite is missing when it is not completed or earlier planned. | Existing ordering matrix + visible issue. |
| CP-06 | A student can import a supported transcript PDF with correct semester/code/credit/grade rows. | 39-row independent oracle, wrapped titles, repeated headers, multipage. |
| CP-07 | A student can paste an IMS grade table and recover all valid rows in their proper terms. | 40-row oracle + tab/whitespace/line-ending variants. |
| CP-08 | A student can review and correct candidate rows before accepting an import. | Browser preview; no pre-commit record mutation. |
| CP-09 | A student can recover from an unsupported/invalid import with row-level explanations and the old record intact. | Malformed/encrypted/image-only/oversized input and atomicity tests. |
| CP-10 | A student's course variants, zero-credit obligations and distinct repeated registrations are preserved. | ES 242(N), PE/IN and two CS 299 fixtures. |
| CP-11 | A student can re-import without duplicating the same attempt: a new import replaces the earlier imported rows, and a changed row they typed in themselves still needs a decision. | Idempotence, revised grade, dropped row, user-correction and distinct-instance tests. |
| CP-12 | A student can see discrepancies between source totals, extracted rows and degree-countable credits. | PDF 104 vs paste 105; separate classification, no forced equality. |
| CP-13 | A student can inspect source evidence and unresolved catalogue/equivalence matches for imported rows. | CS 203/202 stays unresolved without approval. |
| CP-14 | A student's earned-credit, prerequisite-exposure and performance status follow separate approved grade policies. | P/D/E/F/unknown/blank matrix and zero-credit obligations. |
| CP-15 | A student can inspect CPI and its counted credits/points, with discrepancies or incomplete policies identified. | The sample record's totals reproduced from its graded rows; P exclusion, cap/rounding and repeat-policy cases. |
| CP-16 | A student can inspect term SPI with its counted attempts and calculation. | Independently calculated terms, fail/repeat/withdrawal policy tests. |
| CP-17 | A student's mandatory choices and overlapping basket requirements are evaluated without prohibited double counting. | Alternative allocations, narrow-basket adversary, total conservation. |
| CP-18 | A student can see project/online/exposure caps and excluded credits, including approved exceptions. | 8-credit combined cap, project cap, quad/exposure limits and evidence. |
| CP-19 | A student can trace every audit decision to its applicable rule version and source. | Explanation/source completeness; wrong-cohort rejection. |
| CP-20 | A student sees separate actual/current/projected progress and cannot receive an unconditional completion result with missing required evidence. | Incomplete core, pending grade, missing policy and projected-pass cases. |
| CP-21 | A student can see normal/GPS/summer/advisor load violations and approval-dependent overload status. | Boundary and approval-condition tests. |
| CP-22 | A student receives duplicate and nested AND/OR/co-requisite/exposure explanations in plan validation. | Ordering truth tables, duplicate/repeat policy and unknown prerequisite. |
| CP-23 | A student can inspect confirmed/tentative/unknown availability for the selected planning term. | Complete vs partial offering snapshot; historical pattern never confirmed. |
| CP-24 | A student can choose sections and see overlapping required meetings, or that clashes could not be checked. | Lecture/lab, alternatives, touching endpoints, quads, missing meetings. |
| CP-25 | ~~A student can inspect CSE honours eligibility, progress and remaining approved requirements.~~ Withdrawn 3 Nov (D-18). | Reviewed honours dataset, required project and overlap constraints. |
| CP-26 | ~~A student can inspect AI minor eligibility, progress and remaining approved requirements.~~ Withdrawn 3 Nov (D-18). | Reviewed AI minor dataset; base-core exclusions and project limits. |
| CP-27 | ~~A student can inspect a joint base/honours/AI-minor allocation without exceeding allowed sharing.~~ Withdrawn 3 Nov (D-18). | Joint adversarial allocation; two-open-elective sharing limits. |
| CP-28 | A student can compare isolated drop/fail/postpone/replace/credit-cap scenarios against a baseline. | Immutable-history check, downstream issues, hypothetical metric labels. |
| CP-29 | A student can sign in on another device, retrieve saved records/plans, and resolve conflicting saves. | Signup/login/logout, two-browser test, stale-revision conflict and persistence. |
| CP-30 | A student can export a readable audit/plan and a versioned backup of their own record. | Printed report + JSON round-trip, sources, unknowns and revision. |
| CP-31 | A student can complete import, requirement inspection and planning using a phone or keyboard. | Browser accessibility/responsive flows plus observed user session. |
| CP-32 | A student's personal data is accessible only to that account and can be deleted. | Two-user access/export/delete tests; CSRF, temporary-upload cleanup. |
| CP-33 | A student can compare no-internship, 3-month and 6-month scenarios using exact dates and see affected courses and completion assumptions. | Calendar boundaries, summer/semester presets, full/partial term conflicts, downstream prerequisites and immutable baseline. |
| CP-34 | A student can inspect proposed versus approved internship modules and their eligible credit allocation without duration-based credit awards. | Zero automatic credit; 4 credits per quad/16 overall; HSS/open-project caps; no duplicated modules or unauthorized approvals. |

With 34 statements, October 27 requires **at least 17 green**, each delivered through reviewed, merged PRs. Target CP-01..16 and CP-29 as the first vertical release, with authentication/persistence already working. November 3 requires **all 34 green**, including real supported academic data and browser evidence. Missing official data is a release blocker for the affected promise; a synthetic test or a permanent 'unknown' placeholder does not make that feature complete. The named schedules in `docs/team/` give the task-level dependencies and acceptance checks for this target.

## 9. Delivery schedule and three workstreams

The assignment specifies dates, not an hour for these checkpoints. Keep the official dates and use broad work blocks. Internal readiness checkpoints after the feature freeze are five days apart, on8 and13 November. Required deadlines/events remain exceptions to that cadence; do not add daily or previous-evening mini-checkpoints.

| Checkpoint (IST, 2026) | Work block and exit gate |
| --- | --- |
| **Tue27 Oct: official checkpoint** | Work block22-27 Oct: finalize34 statements/test mapping; contracts; PDF/IMS imports/review; account-owned persistence; initial audit, prerequisites, planner and CPI/SPI; root run/test commands and real browser integration. At least17 statements green, each delivered through reviewed merged PRs. A stranger runs from README. |
| **Tue3 Nov: official full-feature/spec-freeze deadline** | Work block28 Oct-3 Nov: complete caps/joint awards, offerings/clashes, internship choices/modules, scenarios, exports/deletion, independent regression/user/accessibility checks, hosted persistence/restore and release evidence. All34 statements green; freeze SPEC and preserve the reviewed baseline. |
| **Sun8 Nov: internal review checkpoint** | Verify cross-group findings, regression coverage and test honesty; ensure every outstanding issue has an owner. The official2-10 November four-session review window still applies. |
| **Fri13 Nov: internal readiness checkpoint** | Complete demo/installation/restore rehearsals, synthetic fallback and extension practice. Keep a tested release ready for the unseen request. |
| **Mon16 Nov: official acceptance run** | Receive the actual unseen request, add a SPEC statement and failing tests, implement/review/merge and run full regression plus the actual user flow. |
| **Tue17 Nov: official demo** | Demonstrate both imports, explainable academic analysis, internship comparisons, cross-device save and the actual acceptance-run feature; have the tested synthetic local fallback ready. |

Task order and readiness handoffs inside each block do not create extra dated checkpoints. October27 and November3 are seven days apart because those are official dates; November16 and17 are consecutive mandatory events.

Three workstreams, assigned as requested, with detailed instructions in `docs/team/`:

| Owner | Primary deliverables | Contract with others |
| --- | --- | --- |
| Harsh | Python academic engine; PDF/IMS imports; reviewed curriculum/award rules; Django accounts, API, persistence, scenarios and integration. | Owns canonical schema/API and source-governed academic decisions. See [Harsh tasks](team/harsh.md). |
| Aaryan | All student-facing screens and responsive design; API client and save states; import/audit/planner/performance/award/internship views; browser acceptance. | Uses authoritative server results and shared examples. See [Aaryan tasks](team/aaryan.md). |
| Manashree | Timetable/calendar source adapter/data; independent fixtures and reconciliation; root run/test commands, CI, operating docs and release/user verification. | Supplies reviewed source candidates and independent expected results. See [Manashree tasks](team/manashree.md). |

Manashree owns timetable ingestion, Harsh owns validation/storage and Aaryan owns section/clash interaction; the shared snapshot contract connects them. Each PR must be reviewed by another member. Keep PRs small enough to review promptly; integrate slices as they become ready, and ensure each member has a real reviewed merged contribution. AI-use notes belong in the actual contributor's lab notes with the actual class number and work, never generated attribution.

Critical path: **official 2024 rules and exceptions -> canonical attempts -> imports/review -> correct allocation/performance -> planning -> award/scenario integration -> observed use and release**. Account and UI foundations proceed alongside it using the published written contracts. The team instructions explicitly list independent starting tasks and the data/API/integration handoffs.

## 10. Testing, run commands and release evidence

- Retain the existing unittest suite; use Django tests for ownership, database/transaction and API behavior. Add Vitest/component tests where useful and Playwright for actual end-to-end flows.
- Write expected academic results independently; retain negative/adversarial cases: fail counts as passed, P inflates CPI, project erased by deduplication, course reallocated twice, tentative offering treated as confirmed, missing timetable treated as clear, unauthorized record export, scenario mutates history, stale device overwrites edits.
- Test nested prerequisite logic, exact decimal sums, chronological imports, source coverage and allocation determinism. Check schema/data migrations and a database round trip. Run integration tests against the hosted database type before release.
- Run the browser suite through real parsers/API/domain/storage. UI tests backed only by fixed mocked totals cannot establish a working feature. Use two browser contexts for cross-device and cross-user tests.
- CI: Python/domain/API tests, schema/data validation, frontend typecheck/unit tests/build, then browser acceptance against the started application; publish a SPEC-to-test report and non-personal failure artifacts. Do not expose real records in screenshots/logs.
- Planned root commands after documented setup: `python scripts/run.py` starts the local web stack; `python scripts/test.py` runs all required checks and exits nonzero if any fail. These scripts do not exist yet. README must document Python/Node versions, installation/migrations/browser setup, development configuration, sample account/data and production differences. A fresh local run uses SQLite and requires no external credentials.
- Hosted release needs HTTPS, environment-based secrets, `DEBUG=False`, allowed origins/hosts, production server, migrations, PostgreSQL persistence and backup/restore. Run Django's production deployment checks. Frontend build and API are served under one origin. Choose the actual hosting provider based on available accounts/budget; do not assume a free instance preserves disk or database state.
- Every checkpoint records exact commit, total statements, green statements, tests, reviewed PRs and human flows tried. At release, include source manifest, known limitations/unknowns, operating instructions and demo script. A passing suite must not mask missing official data.

## 11. Official documents and decisions still needed

The supplied advisory and sample inputs are enough to start the schema, parsers, review UI and baseline audit. They are **not enough to certify all requested analyses**.

| Readiness / checkpoint | Obtain | Why it is needed |
| --- | --- | --- |
| **First release:27 Oct** | Current 2024-entry CSE curriculum amendments and approved course-equivalence/substitution list, specifically CS 203 vs CS 202, ES 242(N), historical/new OS/network/digital-systems codes. | Correct core completion and credits; cannot infer from similar names. |
| **First release:27 Oct** | Current approved CSE elective/basket lists plus BS/HSS/GE/open-elective and additional-learning classification guidance. | Department prefix/catalogue membership does not prove basket eligibility; SC 372 needs classification. |
| **First release:27 Oct** | Official grading/evaluation, repeat/substitution, incomplete/withdrawal and CPI/SPI policies; passing/exposure rules and their effective dates. | Correct exceptional attempts, denominators, grade replacement, rounding/caps and prerequisites. |
| **Full release:3 Nov** | Current CSE honours definition/approved list and the **complete AI minor advisory** applicable to 2024 CSE students, including all amendments and permitted overlap/project constraints. | All award requirements, eligibility and joint credit sharing. A general 20-credit description is insufficient. |
| **Before the affected feature is accepted** | Course-wise prerequisites/co-requisites, minimum grades/exposure, restrictions and consent requirements for the supported planning catalogue. | Correct eligibility; do not reconstruct prerequisites from syllabus topics. |
| **Full release:3 Nov** | Final offering/registration list for **2026-27 Semester I**, with course codes/credits/sections and revision date; confirmed **Semester II** list as soon as available. | The sample record ends before the current term. The published list found in this review is tentative and title-based. Need current enrolment separately. |
| **Full release:3 Nov** | Supplied Semester-I timetable and slot legend are now available. Confirm publication/revision/finality and any ambiguous section/lab alternatives or active quad/half-semester dates; obtain future-term timetables when published. | Normalize the supplied snapshot now; do not equate the filename with finality or copy slots into future semesters. |
| **Before the affected feature is accepted** | Project-course repeat/counting and online-course credit policy; open-project vs 16-credit cap interpretation; any relevant individual approvals. | Correct CS 299 instances, combined 8-credit elective cap and overall project allocation. |
| **Before the affected feature is accepted** | Detailed external-exposure advisory and approval/mapping forms; clarification of comprehensive-viva completion semantics. | Required for real exposure/viva cases; preserve unknowns until reviewed. |
| **Before the affected feature is accepted** | GPS/standing/load-approval norms, active-semester/leave/restart metadata format and credit-expiry/extension guidance. | Enforce conditional load and duration rules for affected users. |
| **Before the affected feature is accepted** | A few consented, anonymized additional input examples covering longer/multipage records, failed/repeated grades and incomplete/current enrolment, plus independently checked expected results. | One clean transcript cannot validate the exceptional cases. Synthetic cases complement real layouts. |
| **Local27 Oct; hosted3 Nov** | Hosting/account/domain availability, budget and recovery-email configuration if self-service reset is required; final demo environment. | Cross-device saving requires a running shared server and persistent database. |

Ask the academic office/faculty advisor for clarification where a public source is incomplete; the team should provide authorized copies/links rather than share portal credentials. No contact messages have been sent as part of this review. Redact names/roll numbers in committed fixtures and shared demonstrations.

### Remaining decisions / go-no-go conditions

1. Planning focus is confirmed: full remaining degree with evidence labels. The supplied current-term snapshot can support actual slot checks; subsequent terms remain tentative/unknown until dated sources are available. Neither import nor the example plan establishes actual present registrations.
2. CS 203/CS 202 remains explicitly unresolved. Obtain official treatment of that substitution, repeated CS 299 and SC 372; these affect the student's audit, not just parser mechanics.
3. Select hosting and account recovery arrangements. Initial recommendation is ordinary CoursePath accounts with Django sessions; institutional SSO is not assumed.
4. Ownership is assigned to Harsh, Aaryan and Manashree in the team instructions. Confirm the reviewer rotation and book real user verification before the freeze.

If required academic data is unavailable when a dependent feature needs it, continue independent parser/UI/account work but immediately flag the affected checkpoint promises and obtain an explicit scope/deadline decision. Do not remove promised features silently, certify uncertain rules, or count synthetic-only placeholders as finished. With all requested analyses, the 3 November freeze is a tight integration deadline; explicit contracts, timely data handoffs and reviewed integration are the main controls.
