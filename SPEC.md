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

## Checkable statements

- **CP-01:** A student can view every graduation requirement of the supported curriculum grouped by its basket before entering any academic history.
- **CP-02:** A student can manually record a course attempt as completed, in progress, or failed/not completed.
- **CP-03:** A student can inspect the completed courses and credits counted toward each requirement in their degree audit.
- **CP-04:** A student can add and remove courses in a future semester table that shows the semester's total credits.
- **CP-05:** A student can see which prerequisite is unsatisfied when a planned course depends on a course that is neither completed nor planned in an earlier semester.

## October 9 test coverage

| Statement | Automated test | Checkpoint status |
| --- | --- | --- |
| CP-01 | `tests/test_requirements.py::RequirementsBeforeHistoryTests.test_cp01_all_requirements_are_grouped_without_academic_history` | Written; runs and fails because the requirements view is unimplemented. |
| CP-02 | `tests/test_academic_history.py::AcademicHistoryTests.test_cp02_record_all_supported_attempt_statuses` | Written; runs and fails because academic history entry is unimplemented. |
| CP-03 | `tests/test_degree_audit.py::DegreeAuditTests.test_cp03_show_counted_completed_courses_and_credits_per_requirement` | Written; runs and fails because the degree audit is unimplemented. |
| CP-04 | `tests/test_semester_plan.py::SemesterPlanTests.test_cp04_add_and_remove_courses_with_updated_semester_totals` | Written; runs and fails because semester editing is unimplemented. |
| CP-05 | `tests/test_prerequisites.py::PrerequisiteTests.test_cp05_explain_unsatisfied_prerequisites_in_semester_order` | Written; runs and fails because prerequisite validation is unimplemented. |

For now, all five tests use explicitly synthetic courses and requirements, not IITGN curriculum data. They check the domain behavior promised by each statement.
