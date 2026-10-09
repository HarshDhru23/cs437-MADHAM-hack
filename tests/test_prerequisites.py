"""CP-05: synthetic prerequisite ordering, not official IITGN rules."""

import unittest

from coursepath.prerequisites import explain_unsatisfied_prerequisites


class PrerequisiteTests(unittest.TestCase):
    def test_cp05_explain_unsatisfied_prerequisites_in_semester_order(self):
        catalogue = {
            "SYNTH-101": {"prerequisites": []},
            "SYNTH-201": {"prerequisites": ["SYNTH-101"]},
        }
        cases = {
            "missing": ([], []),
            "same_semester": ([], [{"semester_id": 5, "course_ids": ["SYNTH-101"]}]),
            "later_semester": ([], [{"semester_id": 6, "course_ids": ["SYNTH-101"]}]),
            "failed": ([{"course_id": "SYNTH-101", "status": "FAILED"}], []),
            "in_progress": ([{"course_id": "SYNTH-101", "status": "IN_PROGRESS"}], []),
            "earlier_semester": ([], [{"semester_id": 4, "course_ids": ["SYNTH-101"]}]),
            "completed": ([{"course_id": "SYNTH-101", "status": "COMPLETED"}], []),
        }
        expected_issue = {
            "course_id": "SYNTH-201",
            "prerequisite_id": "SYNTH-101",
            "reason": "SYNTH-101 is neither completed nor planned in an earlier semester.",
        }

        actual_by_case = {
            name: explain_unsatisfied_prerequisites(
                "SYNTH-201", 5, catalogue, history, {"semesters": semesters}
            )
            for name, (history, semesters) in cases.items()
        }

        self.assertEqual(
            actual_by_case,
            {
                "missing": [expected_issue],
                "same_semester": [expected_issue],
                "later_semester": [expected_issue],
                "failed": [expected_issue],
                "in_progress": [expected_issue],
                "earlier_semester": [],
                "completed": [],
            },
            "CP-05: name the unsatisfied prerequisite; only completed "
            "courses or earlier planned semesters satisfy this synthetic rule.",
        )
