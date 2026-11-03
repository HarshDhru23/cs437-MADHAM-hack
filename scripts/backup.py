"""Versioned database backup and verified restore for CoursePath (M08).

    python scripts/backup.py dump    --out <backup.json>
    python scripts/backup.py restore --input <backup.json>
    python scripts/backup.py summary

The target database is whatever server/config/settings.py selects from the
environment: local SQLite by default, COURSEPATH_SQLITE_PATH for another SQLite
file, or PostgreSQL via COURSEPATH_ENV=production / COURSEPATH_DB_ENGINE and the
COURSEPATH_DB_* variables. Restore only goes into an EMPTY, separately migrated
database, refuses backups from a newer schema, and fails unless the restored row
counts and record/plan revisions equal the summary stored at dump time.

Accounts, records, attempts, plans, scenarios, approvals and rule/offering
snapshots are included. Expiring import previews (which hold extracted
transcript rows), sessions and login throttles are deliberately excluded.
A backup file contains personal academic data and password hashes: keep it out
of Git, CI artifacts and shared drives, and delete it per the retention rule in
docs/operations/runbook.md.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANAGE = ROOT / "server" / "manage.py"
FORMAT_VERSION = "1"
INCLUDED = ["auth.user", "records.academicrecord", "records.attempt", "records.academicplan", "records.scenario",
            "records.approvalevidence", "records.rulesnapshot", "records.offeringsnapshot"]
MODELS = ["AcademicRecord", "Attempt", "ImportPreview", "AcademicPlan", "Scenario", "ApprovalEvidence",
          "RuleSnapshot", "OfferingSnapshot"]
SUMMARY_CODE = """
import json
from django.contrib.auth import get_user_model
from django.db.migrations.recorder import MigrationRecorder
from server.records import models as m
out = {'users': get_user_model().objects.count()}
for name in %r:
    out[name] = getattr(m, name).objects.count()
out['record_revisions'] = sorted(m.AcademicRecord.objects.values_list('revision', flat=True))
out['plan_revisions'] = sorted(m.AcademicPlan.objects.values_list('revision', flat=True))
out['scenario_revisions'] = sorted(m.Scenario.objects.values_list('revision', flat=True))
applied = sorted(MigrationRecorder.Migration.objects.filter(app='records').values_list('name', flat=True))
print('COURSEPATH_SUMMARY ' + json.dumps({'summary': out, 'latest_migration': applied[-1] if applied else None}))
""" % (MODELS,)


class BackupError(Exception):
    pass


def sqlite_env(path):
    """Environment selecting a development SQLite file (used for rehearsals and tests)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("COURSEPATH_DB_")}
    env.update(COURSEPATH_ENV="development", COURSEPATH_SQLITE_PATH=str(path))
    return env


def _manage(env, *args, stdin=None):
    p = subprocess.run([sys.executable, str(MANAGE), *args], cwd=ROOT, env=env, input=stdin,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise BackupError(f"manage.py {args[0]} failed:\n{(p.stderr or p.stdout).strip()[-2000:]}")
    return p.stdout


def state(env):
    out = _manage(env, "shell", "-c", SUMMARY_CODE)
    line = next((l for l in out.splitlines() if l.startswith("COURSEPATH_SUMMARY ")), None)
    if line is None:
        raise BackupError("could not read the database summary")
    return json.loads(line.split(" ", 1)[1])


def dump(env, out_path):
    """Write a versioned backup and return its summary."""
    current = state(env)
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "objects.json"
        _manage(env, "dumpdata", *INCLUDED, "--natural-foreign", "--output", str(raw))
        objects = json.loads(raw.read_text(encoding="utf-8"))
    body = {"format_version": FORMAT_VERSION, "latest_migration": current["latest_migration"],
            "summary": current["summary"], "objects": objects}
    text = json.dumps(body, sort_keys=True, ensure_ascii=False)
    Path(out_path).write_text(text, encoding="utf-8")
    print(f"backup {out_path}: sha256 {hashlib.sha256(text.encode('utf-8')).hexdigest()}, {len(objects)} objects")
    return current["summary"]


def _expected(summary):
    """Summary a correct restore must reproduce: previews are never backed up."""
    return {**summary, "ImportPreview": 0}


def restore(env, in_path):
    """Restore into an empty database selected by `env`; return the verified summary."""
    try:
        body = json.loads(Path(in_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BackupError(f"unreadable backup: {exc}") from exc
    if body.get("format_version") != FORMAT_VERSION:
        raise BackupError(f"unsupported backup format {body.get('format_version')!r}; expected {FORMAT_VERSION}")
    _manage(env, "migrate", "--noinput")
    target = state(env)
    if target["summary"]["users"] or target["summary"]["AcademicRecord"]:
        raise BackupError("target database is not empty; restore only into a fresh, separate database")
    if body.get("latest_migration") and (target["latest_migration"] or "") < body["latest_migration"]:
        raise BackupError(f"backup needs migration {body['latest_migration']}, target has {target['latest_migration']}")
    with tempfile.TemporaryDirectory() as tmp:
        objects = Path(tmp) / "objects.json"
        objects.write_text(json.dumps(body["objects"], ensure_ascii=False), encoding="utf-8")
        _manage(env, "loaddata", str(objects))
    restored = state(env)["summary"]
    expected = _expected(body["summary"])
    diff = sorted(k for k in expected if restored.get(k) != expected[k])
    if diff:
        raise BackupError("restored database differs from the backup summary in: " + ", ".join(diff))
    return restored


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("dump").add_argument("--out", required=True)
    sub.add_parser("restore").add_argument("--input", required=True)
    sub.add_parser("summary")
    args = p.parse_args(argv)
    env = dict(os.environ)
    try:
        if args.command == "dump":
            dump(env, args.out)
        elif args.command == "restore":
            print(json.dumps(restore(env, args.input), indent=2))
            print("restore verified: counts and revisions match the backup summary")
        else:
            print(json.dumps(state(env), indent=2))
    except BackupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
