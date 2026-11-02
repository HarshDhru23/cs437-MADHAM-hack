> "Your grad plan should be something I can verify easily."
> — Aayush Kuloor, IITGN B.Tech CSE student, during our user interview.

# CoursePath specification

Primary user: Aayush Kuloor and other IIT Gandhinagar B.Tech CSE students planning their remaining degree requirements and future semesters.

## Aayush's interview inputs and feedback

The following points summarize Aayush's interview responses.

1. **How he plans today:** He opens the official academic advisory, creates a spreadsheet, and enters the CSE graduation requirements. He then checks his completed courses in IMS, marks the completed courses and requirements in the spreadsheet, prepares tentative future semesters, and cross-checks those courses against the remaining graduation requirements.
2. **Time spent:** He estimated that doing this once took him around 10 minutes. He pointed out that other students may take much longer.
3. **Concerns about mistakes:** Students can make mistakes during these manual checks, and errors in graduation planning can be very costly. He emphasized that the software must be reliable and easy to verify.
4. **His main expectation:** "Your grad plan should be something I can verify easily." He wants to be able to independently check the resulting graduation plan.
5. **Show the full requirements first:** He asked to see the entire CSE graduation requirements before the software considers his personal course history.
6. **Group requirements clearly:** He asked for requirements to be organized into their corresponding categories or baskets so the curriculum structure is easy to understand.
7. **Mark completion using his courses:** After his completed courses are entered, he wants tick marks or completion states for individual courses, baskets, elective groups, and credit requirements.
8. **Let him choose future courses:** He wants to select the courses he plans to take in future semesters himself.
9. **Use a semester table:** He asked for future semesters to appear in an easy-to-understand, table-like format.

CoursePath will provide a requirements-first degree audit and a semester planner with deterministic checks and explanations that Aayush can verify.

Initial scope: one IITGN B.Tech CSE curriculum/batch version, with manually entered academic history. The specific batch and official curriculum data still need to be confirmed. 

## October 16 checkable statements

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

The table is the October 16 scope. Its evidence column describes the intended acceptance evidence, not completed verification. The October 9 test coverage below remains historical.

## October 16 automated test coverage

| Statement | Automated test |
| --- | --- |
| CP-01 | `tests/test_requirements.py::RequirementsBeforeHistoryTests.test_cp01_all_requirements_are_grouped_without_academic_history` |
| CP-02 | `tests/test_academic_history.py::AcademicHistoryTests.test_cp02_record_all_supported_attempt_statuses` |
| CP-03 | `tests/test_degree_audit.py::DegreeAuditTests.test_cp03_show_counted_completed_courses_and_credits_per_requirement` |
| CP-04 | `tests/test_semester_plan.py::SemesterPlanTests.test_cp04_add_and_remove_courses_with_updated_semester_totals`; `tests/test_oct16_submission.py::October16SubmissionTests.test_cp04_move_preserves_courses_and_updates_both_semesters` |
| CP-05 | `tests/test_prerequisites.py::PrerequisiteTests.test_cp05_explain_unsatisfied_prerequisites_in_semester_order` |
| CP-06 | `tests/test_oct16_submission.py::October16SubmissionTests.test_cp06_pdf_rows_keep_terms_codes_credits_and_grades` |
| CP-07 | `tests/test_oct16_submission.py::October16SubmissionTests.test_cp07_ims_rows_keep_their_terms_across_line_endings` |
| CP-08 | `tests/test_oct16_submission.py::October16SubmissionTests.test_cp08_review_and_correct_without_mutating_saved_record` |
| CP-09 | `tests/test_oct16_submission.py::October16SubmissionTests.test_cp09_invalid_rows_are_explained_without_mutating_saved_record` |
| CP-10 | `tests/test_oct16_submission.py::October16SubmissionTests.test_cp10_variants_zero_credits_and_repeats_survive_acceptance` |

These are failing specification tests against the main-branch scaffold. Import tests load the future October 27 API inside each test, so missing implementations produce assertion failures rather than preventing test discovery. Fixtures are synthetic; official CSE 2024 completeness, browser workflows, the full transcript/paste oracles and the wider invalid-input matrix still require the evidence listed above.

## October 9 test coverage

| Statement | Automated test | Checkpoint status |
| --- | --- | --- |
| CP-01 | `tests/test_requirements.py::RequirementsBeforeHistoryTests.test_cp01_all_requirements_are_grouped_without_academic_history` | Written; runs and fails because the requirements view is unimplemented. |
| CP-02 | `tests/test_academic_history.py::AcademicHistoryTests.test_cp02_record_all_supported_attempt_statuses` | Written; runs and fails because academic history entry is unimplemented. |
| CP-03 | `tests/test_degree_audit.py::DegreeAuditTests.test_cp03_show_counted_completed_courses_and_credits_per_requirement` | Written; runs and fails because the degree audit is unimplemented. |
| CP-04 | `tests/test_semester_plan.py::SemesterPlanTests.test_cp04_add_and_remove_courses_with_updated_semester_totals` | Written; runs and fails because semester editing is unimplemented. |
| CP-05 | `tests/test_prerequisites.py::PrerequisiteTests.test_cp05_explain_unsatisfied_prerequisites_in_semester_order` | Written; runs and fails because prerequisite validation is unimplemented. |

For now, all five tests use explicitly synthetic courses and requirements, not IITGN curriculum data. They check the domain behavior promised by each statement.

## October 27 implementation scope (not release certification)

The selected cohort is 2024-entry B.Tech CSE. Both imports and account persistence are required. The October 9 text above is historical. The following complete statement map supersedes its initial scope. Source-dependent promises remain blocked until committed approved evidence and human/browser verification exist.

| ID | Checkable statement | Primary evidence/test |
| --- | --- | --- |
| CP-01 | A student can inspect all CSE 2024 requirements grouped by basket before supplying history. | Existing test + requirements browser flow and approved-data completeness. |
| CP-02 | A student can record/correct completed, in-progress and failed course attempts without losing prior attempts. | Existing test + edit/commit integration. |
| CP-03 | A student can inspect counted completed courses/credits and remaining requirements. | Existing test + independently hand-audited record. |
| CP-04 | A student can add/remove/move future courses and see semester credit totals. | Existing test + browser planner workflow. |
| CP-05 | A student can see which recommended preparation (CoursePath team list) is missing when it is not completed or planned earlier; it warns and never blocks the plan. | Existing ordering matrix + visible warning; unlisted courses show "no recommendation recorded". |
| CP-06 | A student can import a supported transcript PDF with correct semester/code/credit/grade rows. | 39-row independent oracle, wrapped titles, repeated headers, multipage. |
| CP-07 | A student can paste an IMS grade table and recover all valid rows in their proper terms. | 40-row oracle + tab/whitespace/line-ending variants. |
| CP-08 | A student can review and correct candidate rows before accepting an import. | Browser preview; no pre-commit record mutation. |
| CP-09 | A student can recover from an unsupported/invalid import with row-level explanations and the old record intact. | Malformed/encrypted/image-only/oversized input and atomicity tests. |
| CP-10 | A student's course variants, zero-credit obligations and distinct repeated registrations are preserved. | ES 242(N), PE/IN and two CS 299 fixtures. |
| CP-11 | A student can re-import without duplicating the same attempt and can resolve conflicting changes. | Idempotence, revised grade, user-correction and distinct-instance tests. |
| CP-12 | A student can see discrepancies between source totals, extracted rows and degree-countable credits. | PDF 104 vs paste 105; separate classification, no forced equality. |
| CP-13 | A student can inspect source evidence and unresolved catalogue/equivalence matches for imported rows. | CS 203/202 stays unresolved without approval. |
| CP-14 | A student's earned-credit, prerequisite-exposure and performance status follow separate approved grade policies. | P/D/E/F/unknown/blank matrix and zero-credit obligations. |
| CP-15 | A student can inspect CPI and its counted credits/points, with discrepancies or incomplete policies identified. | Sample 849/92 -> 9.23; P exclusion, cap/rounding and repeat-policy cases. |
| CP-16 | A student can inspect term SPI with its counted attempts and calculation. | Independently calculated terms, fail/repeat/withdrawal policy tests. |
| CP-17 | A student's mandatory choices and overlapping basket requirements are evaluated without prohibited double counting. | Alternative allocations, narrow-basket adversary, total conservation. |
| CP-18 | A student can see project/online/exposure caps and excluded credits, including approved exceptions. | 8-credit combined cap, project cap, quad/exposure limits and evidence. |
| CP-19 | A student can trace every audit decision to its applicable rule version and source. | Explanation/source completeness; wrong-cohort rejection. |
| CP-20 | A student sees separate actual/current/projected progress and cannot receive an unconditional completion result with missing required evidence. | Incomplete core, pending grade, missing policy and projected-pass cases. |
| CP-21 | A student can see normal/GPS/summer/advisor load violations and approval-dependent overload status. | Boundary and approval-condition tests. |
| CP-22 | A student receives duplicate and nested AND/OR/co-requisite/exposure explanations for recommended preparation in plan validation. | Ordering truth tables, duplicate/repeat policy, identity-resolved codes and unknown (unlisted) recommendations. |
| CP-23 | A student can inspect confirmed/tentative/unknown availability for the selected planning term. | Complete vs partial offering snapshot; historical pattern never confirmed. |
| CP-24 | A student can choose sections and see overlapping required meetings, or that clashes could not be checked. | Lecture/lab, alternatives, touching endpoints, quads, missing meetings. |
| CP-25 | A student can inspect CSE honours eligibility, progress and remaining approved requirements. | Reviewed honours dataset, required project and overlap constraints. |
| CP-26 | A student can inspect AI minor eligibility, progress and remaining approved requirements. | Reviewed AI minor dataset; base-core exclusions and project limits. |
| CP-27 | A student can inspect a joint base/honours/AI-minor allocation without exceeding allowed sharing. | Joint adversarial allocation; two-open-elective sharing limits. |
| CP-28 | A student can compare isolated drop/fail/postpone/replace/credit-cap scenarios against a baseline. | Immutable-history check, downstream issues, hypothetical metric labels. |
| CP-29 | A student can sign in on another device, retrieve saved records/plans, and resolve conflicting saves. | Signup/login/logout, two-browser test, stale-revision conflict and persistence. |
| CP-30 | A student can export a readable audit/plan and a versioned backup of their own record. | Printed report + JSON round-trip, sources, unknowns and revision. |
| CP-31 | A student can complete import, requirement inspection and planning using a phone or keyboard. | Browser accessibility/responsive flows plus observed user session. |
| CP-32 | A student's personal data is accessible only to that account and can be deleted. | Two-user access/export/delete tests; CSRF, temporary-upload cleanup. |
| CP-33 | A student can compare no-internship, 3-month and 6-month scenarios using exact dates and see affected courses and completion assumptions. | Calendar boundaries, summer/semester presets, full/partial term conflicts, downstream prerequisites and immutable baseline. |
| CP-34 | A student can inspect proposed versus approved internship modules and their eligible credit allocation without duration-based credit awards. | Zero automatic credit; 4-credit modules, 16 overall, no per-quad limit (D-14); HSS/open-project caps; no duplicated modules or unauthorized approvals. |

## November 3 implementation status (not release certification)

Status per statement comes from running its mapped tests: `python scripts/statement_report.py --all` (add `--browser --frontend` for the UI suites). This section does not record a pass count. A statement is release-complete only with its tests green, a real browser flow, review by another member and a merged PR (`schemas/statement-test-map.json`). The table lists, for the November statements, what the backend now does and what is still missing.

| ID | Backend behavior with tests | Still needed for release |
| --- | --- | --- |
| CP-17 to CP-22 | Exclusive allocation, caps, sources, actual/current/projected views, load limits and recommended preparation; course identity groups (D-04) resolve old and variant codes. | The curriculum is still draft: institute core, maths, science and HSS memberships are not in committed files; D-06 to D-16 are not yet encoded; browser evidence. |
| CP-23, CP-24 | Availability from a stored term snapshot; clashes by weekday, minutes and active dates; undated or alternative meetings give possible clashes; no snapshot is `not_checked`, except that a semester with no snapshot and no courses still reports `clear` until #22 merges. | A reviewed 2026-27 Semester I snapshot (GAP-02), lab/tutorial alternative semantics (AMB-12) and quad dates (AMB-13); section-choice UI. |
| CP-25 to CP-27 | Not implemented: D-18 defers CSE honours and the AI minor. | The AI minor document and CSE honours list (GAP-07). |
| CP-28 | Scenarios with drop, fail, postpone, replace, caps and hypothetical grades; deltas; stale scenarios need rebase; plan-only apply. | Scenario UI and browser evidence. |
| CP-30 | Versioned JSON export; restore through preview, diff and confirmed commit. | Printable report view and browser evidence. |
| CP-31 | Frontend responsibility. | Phone and keyboard browser flows and an observed user session. |
| CP-32 | Owner-only data, re-authenticated deletion (data or account), expired-preview purge, production settings check. | Hosted deployment and PostgreSQL verification (GAP-13). |
| CP-33, CP-34 | Exact-date internships, calendar-month arithmetic, attendance conflicts, downstream courses; IN 498 modules under D-14; none / 3 / 6 month comparison. | An academic calendar (GAP-03) for presets and overlap checks; internship UI and browser evidence. |
