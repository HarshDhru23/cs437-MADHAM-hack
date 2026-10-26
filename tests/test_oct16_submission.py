"""October 16 specification tests; all academic inputs here are synthetic.

Import APIs deliberately match the October 27 branch. Resolve them inside each
test so an unimplemented feature fails an assertion, not test discovery.
"""

from copy import deepcopy
from importlib import import_module
import unittest

from coursepath.semester_plan import edit_semester_plan


HEADER = "Academic Period\tCourse No\tCourse Name\tCredit\tGrade\n"
TABLE = HEADER + (
    "2024-25 Semester I\tES242(N)\tSynthetic tools\t4\tA-\n"
    "2024-25 Semester II\tPE101\tSynthetic physical education\t0\tP\n"
    "2024-25 Semester II\tIN101\tSynthetic induction\t0\tP\n"
    "2025-26 Semester I\tCS299\tSynthetic project one\t4\tB\n"
    "2025-26 Semester II\tCS 299\tSynthetic project two\t4\tA\n"
)
EXPECTED_ROWS = [
    ("2024-25-I", "ES 242(N)", "4", "A-"),
    ("2024-25-II", "PE 101", "0", "P"),
    ("2024-25-II", "IN 101", "0", "P"),
    ("2025-26-I", "CS 299", "4", "B"),
    ("2025-26-II", "CS 299", "4", "A"),
]


def row_values(rows):
    return [(r["term_id"], r["normalized_code"], r["credits"], r["grade"])
            for r in rows]


def synthetic_transcript():
    """Build a small two-page, text-based PDF without external packages."""
    def text(x, y, value):
        escaped = value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        return f"BT /F1 9 Tf {x} {y} Td ({escaped}) Tj ET\n"

    pages = [
        ("2024-25 Semester I", [
            ("ES 242(N)", "Synthetic tools", "4", "A-"),
            ("PE 101", "Synthetic sport", "0", "P"),
        ]),
        ("2025-26 Semester II", [
            ("CS 299", "Synthetic project", "4", "A"),
        ]),
    ]
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for term, rows in pages:
        content = text(20, 780, "B.Tech CSE | Admission 2024 | SYNTHETIC")
        content += text(20, 740, "Academic Period: " + term)
        for x, label in [(20, "Course No"), (92, "Course Name"),
                         (250, "Credit"), (290, "Grade")]:
            content += text(x, 720, label)
        for index, values in enumerate(rows):
            for x, value in zip((20, 92, 250, 290), values):
                content += text(x, 700 - index * 40, value)
            if values[0] == "ES 242(N)":
                content += text(92, 690, "Wrapped title")
        stream = content.encode("ascii")
        stream_id = len(objects) + 2
        objects.append(("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 800] "
                        "/Resources << /Font << /F1 3 0 R >> >> "
                        f"/Contents {stream_id} 0 R >>").encode("ascii"))
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode("ascii")
                       + stream + b"endstream")
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend((f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\n"
                   f"startxref\n{xref}\n%%EOF\n").encode("ascii"))
    return bytes(output)


class October16SubmissionTests(unittest.TestCase):
    def implementation(self, module, name):
        try:
            return getattr(import_module(module), name)
        except ModuleNotFoundError as error:
            if error.name == module or module.startswith(error.name + "."):
                self.fail(f"October 16 feature is unimplemented: {module}.{name}")
            raise

    def test_cp04_move_preserves_courses_and_updates_both_semesters(self):
        course = {"course_id": "SYNTH-101", "credits": 4}
        plan = {"semesters": [
            {"semester_id": 5, "courses": [course], "total_credits": 4},
            {"semester_id": 6, "courses": [], "total_credits": 0},
        ]}
        original = deepcopy(plan)
        removed = edit_semester_plan(plan, 5, remove_course_ids=["SYNTH-101"])
        moved = edit_semester_plan(removed, 6, add_courses=[course])
        self.assertEqual(moved, {"semesters": [
            {"semester_id": 5, "courses": [], "total_credits": 0},
            {"semester_id": 6, "courses": [course], "total_credits": 4},
        ]})
        self.assertEqual(plan, original)

    def test_cp06_pdf_rows_keep_terms_codes_credits_and_grades(self):
        parse_pdf = self.implementation("coursepath.imports.pdf_transcript", "parse_pdf")
        preview = parse_pdf(synthetic_transcript(), "oct16-synthetic-pdf")
        self.assertEqual(row_values(preview["candidate_attempts"]), [
            ("2024-25-I", "ES 242(N)", "4", "A-"),
            ("2024-25-I", "PE 101", "0", "P"),
            ("2025-26-II", "CS 299", "4", "A"),
        ])
        self.assertIn("Wrapped title", preview["candidate_attempts"][0]["title"])
        self.assertEqual([r["source_refs"][0]["page"]
                          for r in preview["candidate_attempts"]], [1, 1, 2])
        self.assertEqual(preview["unparsed_rows"], [])

    def test_cp07_ims_rows_keep_their_terms_across_line_endings(self):
        parse_ims = self.implementation("coursepath.imports.ims", "parse_ims")
        for newline in ("\n", "\r\n"):
            with self.subTest(newline=repr(newline)):
                preview = parse_ims(TABLE.replace("\n", newline), "oct16-synthetic-paste")
                self.assertEqual(row_values(preview["candidate_attempts"]), EXPECTED_ROWS)
                self.assertEqual(preview["unparsed_rows"], [])

    def test_cp08_review_and_correct_without_mutating_saved_record(self):
        parse_ims = self.implementation("coursepath.imports.ims", "parse_ims")
        reconcile = self.implementation("coursepath.imports.reconcile", "reconcile_import")
        record = {"attempts": [], "revision": 0}
        original_record = deepcopy(record)
        preview = parse_ims(TABLE, "oct16-synthetic-paste")
        original_preview = deepcopy(preview)
        row = preview["candidate_attempts"][0]
        result = reconcile(record, preview, {row["id"]: {
            "fields": {"title": "Corrected synthetic title"},
            "justification": "Correct synthetic extraction error",
        }})
        accepted = result["record"]["attempts"][0]
        self.assertEqual(accepted["title"], "Corrected synthetic title")
        self.assertEqual(accepted["original"]["title"], row["title"])
        self.assertTrue(accepted["user_corrections"])
        self.assertFalse(any(i["severity"] == "error" for i in result["issues"]))
        self.assertEqual(record, original_record)
        self.assertEqual(preview, original_preview)

    def test_cp09_invalid_rows_are_explained_without_mutating_saved_record(self):
        parse_ims = self.implementation("coursepath.imports.ims", "parse_ims")
        reconcile = self.implementation("coursepath.imports.reconcile", "reconcile_import")
        existing = parse_ims(TABLE, "oct16-synthetic-paste")
        record = reconcile({"attempts": [], "revision": 0}, existing, {})["record"]
        original = deepcopy(record)
        preview = parse_ims(HEADER + "broken synthetic course row\n", "oct16-invalid")
        self.assertEqual(preview["candidate_attempts"], [])
        self.assertEqual(preview["unparsed_rows"], [
            {"line": 2, "raw": "broken synthetic course row"},
        ])
        self.assertTrue(any(i["code"] == "IMPORT_ROW_UNPARSED"
                            and i["severity"] == "error" for i in preview["issues"]))
        result = reconcile(record, preview, {})
        self.assertTrue(any(i["code"] == "IMPORT_ROW_UNPARSED"
                            and i["severity"] == "error" for i in result["issues"]))
        self.assertEqual(result["record"], original)
        self.assertEqual(record, original)

    def test_cp10_variants_zero_credits_and_repeats_survive_acceptance(self):
        parse_ims = self.implementation("coursepath.imports.ims", "parse_ims")
        reconcile = self.implementation("coursepath.imports.reconcile", "reconcile_import")
        preview = parse_ims(TABLE, "oct16-synthetic-paste")
        result = reconcile({"attempts": [], "revision": 0}, preview, {})
        rows = result["record"]["attempts"]
        self.assertEqual(row_values(rows), EXPECTED_ROWS)
        self.assertEqual(len({r["id"] for r in rows}), 5)
        self.assertFalse(any(i["severity"] == "error" for i in result["issues"]))
        self.assertEqual([r["completion_status"] for r in rows[1:3]],
                         ["completed", "completed"])
