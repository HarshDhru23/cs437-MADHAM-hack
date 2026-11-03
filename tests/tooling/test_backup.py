"""M08 backup/restore rehearsal on temporary SQLite databases with a synthetic account.

The same commands run against PostgreSQL when the COURSEPATH_DB_* variables are set;
that path is exercised only where a PostgreSQL server exists (CI job), not here."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cp_script_backup", ROOT / "scripts" / "backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

SEED = """
from django.contrib.auth import get_user_model
from server.records.models import AcademicRecord, AcademicPlan, Attempt, ImportPreview
from django.utils import timezone
user = get_user_model().objects.create_user('synthetic-student', password='synthetic-pass-9431')
record = AcademicRecord.objects.create(owner=user, revision=3)
Attempt.objects.create(record=record, attempt_key='k1', normalized_code='ZZ 100', term_id='2024-25-I', credits='4', grade='A', payload={'id': 'a1'})
AcademicPlan.objects.create(owner=user, revision=2, payload={'semesters': []})
ImportPreview.objects.create(owner=user, record=record, base_record_revision=3, payload={'raw': 'SYNTHETIC PREVIEW TEXT'}, expires_at=timezone.now())
"""


def manage(env, *args, stdin=None):
    return subprocess.run([sys.executable, str(ROOT / "server" / "manage.py"), *args], cwd=ROOT, env=env,
                          input=stdin, capture_output=True, text=True)


class BackupRestoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls._tmp.name)
        cls.env_a = backup.sqlite_env(cls.dir / "a.sqlite3")
        assert manage(cls.env_a, "migrate", "--noinput").returncode == 0
        seeded = manage(cls.env_a, "shell", "-c", SEED)
        assert seeded.returncode == 0, seeded.stderr
        cls.file = cls.dir / "backup.json"
        cls.dump_summary = backup.dump(cls.env_a, cls.file)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def fresh(self, name):
        return backup.sqlite_env(self.dir / f"{name}.sqlite3")

    def test_backup_is_versioned_and_counts_the_seeded_rows(self):
        data = json.loads(self.file.read_text(encoding="utf-8"))
        self.assertEqual(data["format_version"], backup.FORMAT_VERSION)
        s = data["summary"]
        self.assertEqual((s["users"], s["AcademicRecord"], s["Attempt"], s["AcademicPlan"]), (1, 1, 1, 1))
        self.assertEqual(s["record_revisions"], [3])
        self.assertEqual(s["plan_revisions"], [2])
        self.assertTrue(data["latest_migration"])

    def test_expiring_import_previews_and_sessions_are_not_backed_up(self):
        text = self.file.read_text(encoding="utf-8")
        self.assertNotIn("SYNTHETIC PREVIEW TEXT", text)
        self.assertNotIn("records.importpreview", text)
        self.assertNotIn("sessions.session", text)

    def test_restore_into_a_separate_database_reproduces_records_and_revisions(self):
        env_b = self.fresh("restore-ok")
        restored = backup.restore(env_b, self.file)
        self.assertEqual(restored, {**self.dump_summary, "ImportPreview": 0})
        login = manage(env_b, "shell", "-c", "from django.contrib.auth import authenticate;"
                                               "print('LOGIN', bool(authenticate(username='synthetic-student', password='synthetic-pass-9431')))")
        self.assertIn("LOGIN True", login.stdout, login.stderr)

    def test_restore_refuses_a_database_that_already_has_accounts(self):
        with self.assertRaises(backup.BackupError) as ctx:
            backup.restore(self.env_a, self.file)
        self.assertIn("not empty", str(ctx.exception))

    def test_restore_refuses_an_unknown_format_version(self):
        bad = self.dir / "bad-version.json"
        data = json.loads(self.file.read_text(encoding="utf-8"))
        data["format_version"] = "999"
        bad.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(backup.BackupError):
            backup.restore(self.fresh("restore-bad-version"), bad)

    def test_restore_refuses_a_backup_from_a_newer_schema(self):
        bad = self.dir / "bad-migration.json"
        data = json.loads(self.file.read_text(encoding="utf-8"))
        data["latest_migration"] = "9999_from_the_future"
        bad.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(backup.BackupError) as ctx:
            backup.restore(self.fresh("restore-bad-mig"), bad)
        self.assertIn("migration", str(ctx.exception))

    def test_restore_detects_a_tampered_or_truncated_backup(self):
        bad = self.dir / "bad-objects.json"
        data = json.loads(self.file.read_text(encoding="utf-8"))
        data["objects"] = [o for o in data["objects"] if o["model"] != "records.attempt"]
        bad.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(backup.BackupError) as ctx:
            backup.restore(self.fresh("restore-bad-objects"), bad)
        self.assertIn("Attempt", str(ctx.exception))

    def test_cli_dump_and_restore_exit_codes(self):
        out = self.dir / "cli.json"
        env = {**os.environ, **self.env_a}
        p = subprocess.run([sys.executable, str(ROOT / "scripts" / "backup.py"), "dump", "--out", str(out)],
                           cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(out.is_file())
        p = subprocess.run([sys.executable, str(ROOT / "scripts" / "backup.py"), "restore", "--input", str(out)],
                           cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertIn("not empty", p.stderr)


if __name__ == "__main__":
    unittest.main()
