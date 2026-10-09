"""CP-04: synthetic future semesters and course credits."""

import unittest
from copy import deepcopy

from coursepath.semester_plan import edit_semester_plan


class SemesterPlanTests(unittest.TestCase):
    def test_cp04_add_and_remove_courses_with_updated_semester_totals(self):
        first_course = {"course_id": "SYNTH-101", "credits": 3}
        added_course = {"course_id": "SYNTH-201", "credits": 4}
        original_plan = {
            "semesters": [
                {"semester_id": 5, "courses": [first_course], "total_credits": 3},
                {"semester_id": 6, "courses": [], "total_credits": 0},
            ]
        }

        after_add = edit_semester_plan(
            deepcopy(original_plan), semester_id=5, add_courses=[added_course]
        )
        after_remove = edit_semester_plan(
            deepcopy(original_plan), semester_id=5, remove_course_ids=["SYNTH-101"]
        )

        self.assertEqual(
            {"after_add": after_add, "after_remove": after_remove},
            {
                "after_add": {
                    "semesters": [
                        {
                            "semester_id": 5,
                            "courses": [first_course, added_course],
                            "total_credits": 7,
                        },
                        {"semester_id": 6, "courses": [], "total_credits": 0},
                    ]
                },
                "after_remove": {
                    "semesters": [
                        {"semester_id": 5, "courses": [], "total_credits": 0},
                        {"semester_id": 6, "courses": [], "total_credits": 0},
                    ]
                },
            },
            "CP-04: adding and removing courses must update semester rows "
            "and their total credits while preserving other semesters.",
        )
