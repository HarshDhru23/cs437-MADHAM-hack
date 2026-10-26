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
