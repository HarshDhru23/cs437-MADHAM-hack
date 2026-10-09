"""CP-02: synthetic manually entered attempts, not IITGN academic records."""

import unittest
from copy import deepcopy

from coursepath.academic_history import record_course_attempts


class AcademicHistoryTests(unittest.TestCase):
    def test_cp02_record_all_supported_attempt_statuses(self):
        existing_history = [
            {"course_id": "SYNTH-100", "semester_id": 1, "status": "COMPLETED"}
        ]
        entered_attempts = [
            {"course_id": "SYNTH-101", "semester_id": 2, "status": "COMPLETED"},
            {"course_id": "SYNTH-201", "semester_id": 3, "status": "IN_PROGRESS"},
            {"course_id": "SYNTH-202", "semester_id": 2, "status": "FAILED"},
        ]

        expected_history = deepcopy(existing_history + entered_attempts)
        actual_history = record_course_attempts(existing_history, entered_attempts)

        self.assertEqual(
            actual_history,
            expected_history,
            "CP-02: manual entry must preserve previous attempts and record "
            "each new course with its semester and completion status.",
        )
