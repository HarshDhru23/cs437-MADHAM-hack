"""CP-01 acceptance data: entirely synthetic, never official IITGN rules."""

import unittest

from coursepath.requirements import list_graduation_requirements


class RequirementsBeforeHistoryTests(unittest.TestCase):
    def test_cp01_all_requirements_are_grouped_without_academic_history(self):
        # Multiple baskets and rule types expose omissions and lost grouping.
        # These identifiers and thresholds exist only to exercise the contract.
        expected_baskets = [
            {
                "id": "synthetic-core",
                "label": "Synthetic core basket",
                "requirements": [
                    {
                        "id": "synthetic-mandatory",
                        "type": "mandatory_course",
                        "course_id": "SYNTH-101",
                        "source": "Synthetic test fixture; not IITGN data",
                    },
                    {
                        "id": "synthetic-choice",
                        "type": "choose_courses",
                        "minimum_courses": 1,
                        "course_ids": ["SYNTH-201", "SYNTH-202"],
                        "source": "Synthetic test fixture; not IITGN data",
                    },
                ],
            },
            {
                "id": "synthetic-electives",
                "label": "Synthetic elective basket",
                "requirements": [
                    {
                        "id": "synthetic-elective-credits",
                        "type": "minimum_credits",
                        "minimum_credits": 6,
                        "source": "Synthetic test fixture; not IITGN data",
                    }
                ],
            },
            {
                "id": "synthetic-degree-total",
                "label": "Synthetic total graduation credits",
                "requirements": [
                    {
                        "id": "synthetic-total-credits",
                        "type": "minimum_total_credits",
                        "minimum_credits": 20,
                        "source": "Synthetic test fixture; not IITGN data",
                    }
                ],
            },
        ]
        curriculum = {
            "id": "synthetic-curriculum-not-an-iitgn-batch",
            "baskets": expected_baskets,
        }

        actual_baskets = list_graduation_requirements(curriculum)

        self.assertEqual(
            actual_baskets,
            expected_baskets,
            "CP-01: every requirement must be visible in its basket before "
            "the student supplies academic history.",
        )


if __name__ == "__main__":
    unittest.main()
