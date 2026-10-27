import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KINDS = {"advisory", "transcript", "paste", "timetable", "course_plan", "approval", "student_example"}
STATUSES = {"draft", "reviewed", "conflicted"}
AUTHORITIES = {"institutional", "student_provided", "example", None}
REQUIRED = {"id", "kind", "title", "version", "applicable_cohorts", "effective_date", "file_sha256",
            "locator", "review_status", "authority", "retrieved_at", "notes", "in_repository", "url"}


class SourceManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / "data" / "source-manifest.json").read_text(encoding="utf-8"))
        cls.register = (ROOT / "docs" / "data" / "source-register.md").read_text(encoding="utf-8")

    def test_every_entry_has_the_contract_fields(self):
        for s in self.manifest["sources"]:
            self.assertEqual(REQUIRED - set(s), set(), s["id"])
            self.assertIn(s["kind"], KINDS, s["id"])
            self.assertIn(s["review_status"], STATUSES, s["id"])
            self.assertIn(s["authority"], AUTHORITIES, s["id"])

    def test_ids_unique_and_all_in_register(self):
        ids = [s["id"] for s in self.manifest["sources"]]
        self.assertEqual(len(ids), len(set(ids)))
        for i in ids:
            self.assertIn(f"`{i}`", self.register, i)

    def test_committed_sources_hash_matches_file(self):
        import hashlib
        for s in self.manifest["sources"]:
            if s["in_repository"]:
                data = (ROOT / s["locator"]).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), s["file_sha256"], s["id"])

    def test_dates_are_iso_or_null(self):
        for s in self.manifest["sources"]:
            for key in ("effective_date", "retrieved_at"):
                self.assertTrue(s[key] is None or re.fullmatch(r"\d{4}-\d{2}-\d{2}", s[key]), (s["id"], key))

    def test_no_personal_identifiers_or_absolute_paths_in_data_docs(self):
        files = [ROOT / "data" / "source-manifest.json", *(ROOT / "docs" / "data").glob("*.md")]
        for f in files:
            text = f.read_text(encoding="utf-8")
            self.assertIsNone(re.search(r"\b2\d{7}\b", text), f.name)
            self.assertNotRegex(text, r"[A-Z]:\\|/Users/|/home/", f.name)


if __name__ == "__main__":
    unittest.main()
