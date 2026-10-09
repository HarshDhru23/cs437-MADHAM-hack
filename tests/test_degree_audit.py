"""CP-03: synthetic audit rules and credits, never official IITGN data."""

import unittest

from coursepath.degree_audit import explain_degree_audit


class DegreeAuditTests(unittest.TestCase):
    def test_cp03_show_counted_completed_courses_and_credits_per_requirement(self):
        curriculum = {
            "id": "synthetic-curriculum",
            "requirements": [
                {"id": "synthetic-core", "course_ids": ["SYNTH-101"]},
                {
                    "id": "synthetic-electives",
                    "course_ids": ["SYNTH-201", "SYNTH-202", "SYNTH-203", "SYNTH-204"],
                },
            ],
        }
        catalogue = {
            "SYNTH-101": {"credits": 3},
            "SYNTH-201": {"credits": 4},
            "SYNTH-202": {"credits": 4},
            "SYNTH-203": {"credits": 4},
            "SYNTH-204": {"credits": 4},
        }
        history = [
            {"course_id": "SYNTH-101", "status": "COMPLETED"},
            {"course_id": "SYNTH-201", "status": "COMPLETED"},
            {"course_id": "SYNTH-202", "status": "FAILED"},
            {"course_id": "SYNTH-203", "status": "IN_PROGRESS"},
            {"course_id": "SYNTH-204", "status": "PLANNED"},
        ]

        actual_explanations = explain_degree_audit(curriculum, catalogue, history)

        self.assertEqual(
            actual_explanations,
            [
                {
                    "requirement_id": "synthetic-core",
                    "counted_courses": [{"course_id": "SYNTH-101", "credits": 3}],
                    "completed_credits": 3,
                },
                {
                    "requirement_id": "synthetic-electives",
                    "counted_courses": [{"course_id": "SYNTH-201", "credits": 4}],
                    "completed_credits": 4,
                },
            ],
            "CP-03: explain the completed courses and credits for each "
            "requirement without counting failed, in-progress, or planned courses.",
        )
