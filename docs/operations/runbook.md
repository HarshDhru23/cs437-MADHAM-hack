# CoursePath operations runbook (M08)

Status 3 Nov 2026, checked against `main` at `5d3cdfd`. **CoursePath is hosted on Azure App Service** (`coursepath-iitgn`, with Azure Database for PostgreSQL; see `docs/operations/azure.md`), and every merge to `main` that passes the tests deploys automatically. The sections below were written on 3 Nov for local runs; where they say "localhost" they describe a local server, not production. Steps marked *verified* were run on 3 Nov; the rest are procedures.

## 1. Start it

One-time setup is in the README (virtual environment, `pip install -r requirements.txt`, `npm ci` for `frontend/` and `e2e/`). Then:

```sh
python server/manage.py migrate      # creates server/.local/coursepath.sqlite3 on first run
python scripts/run.py                # Django API on 127.0.0.1:8000, Vite on localhost:5173
```

Open the URL `run.py` prints and create an account in the app; there is no default login. `run.py` exits with code 2 and says what is missing if setup is incomplete or a port is taken (`--api-port`, `--web-port` move them). Ctrl+C stops both servers. *Verified* on Windows on 27 Oct and 3 Nov.

Cross-device check (CP-29, local only): with `run.py` running, sign in to the same account in a second browser or a second browser profile, open the plan saved in the first, then edit it in both. The second save of a stale copy gets a conflict instead of overwriting.

## 2. Environment settings

Nothing needs to be set for a local run. The git-ignored `server/.local/` holds the SQLite database, sessions and a generated development secret.

| Name | Local use |
| --- | --- |
| `COURSEPATH_SQLITE_PATH` | Use another SQLite file instead of `server/.local/coursepath.sqlite3`. Read only in development (`COURSEPATH_ENV` unset). Used for restore (§4) and by the tests. |
| `COURSEPATH_API_ORIGIN` | Where the Vite proxy sends `/api` (default `http://127.0.0.1:8000`); `run.py` sets it from `--api-port`. |
| `COURSEPATH_DB_ENGINE=postgresql` with `COURSEPATH_DB_NAME`, `_USER`, `_PASSWORD`, `_HOST`, `_PORT` | Run against a local PostgreSQL instead of SQLite. CI does this in its `postgres` job. |
| `COURSEPATH_REAL_INPUT_DIR` | Folder of private inputs for the optional real-file tests (README, Test). |
| `COURSEPATH_ENV`, `COURSEPATH_SECRET_KEY` | Production mode only. Not used on localhost; `production` requires PostgreSQL, HTTPS, a secret key and `COURSEPATH_GOOGLE_CLIENT_ID` (the server will not start without it). |
| `COURSEPATH_ALLOWED_HOSTS` | Not needed on localhost: the default is `localhost,127.0.0.1,testserver`. |

Names only are in `.env.example`. Never put a real value in Git, CI logs or screenshots.

## 3. Migrations

Run `python server/manage.py migrate` after every pull that adds a migration (`git log --stat -- server/records/migrations`), with `run.py` stopped. Take a backup first (§4.1) if the database holds anything you want to keep. `python server/manage.py showmigrations records` lists what is applied.

## 4. Backup and restore

### 4.1 Whole local database: copy the SQLite file

1. Stop `run.py`. Do not copy the file while the server is running: a copy taken during a write can be inconsistent.
2. Copy `server/.local/coursepath.sqlite3` to a dated file outside the repository, e.g. `coursepath-2026-11-03.sqlite3`.

To restore, either point the server at the copy without touching the original:

```sh
COURSEPATH_SQLITE_PATH=/path/to/coursepath-2026-11-03.sqlite3 python scripts/run.py
# PowerShell: $env:COURSEPATH_SQLITE_PATH = "C:\path\to\coursepath-2026-11-03.sqlite3"; python scripts/run.py
```

or, with `run.py` stopped, copy the file back over `server/.local/coursepath.sqlite3`. A copy taken before a migration needs `migrate` again after it is put back.

### 4.2 Whole database, any engine: `scripts/backup.py`

```sh
python scripts/backup.py summary                        # counts, revisions, latest migration
python scripts/backup.py dump --out <backup.json>       # versioned file with an embedded summary
python scripts/backup.py restore --input <backup.json>  # into an EMPTY, separate database only
```

It uses whichever database the environment selects (§2), so it also works on PostgreSQL. `restore` migrates the target and refuses three things: a non-empty database, an unknown backup format, or a backup from a newer migration. It then loads the data and fails unless every row count and every record, plan and scenario revision equals the summary written at dump time.

- Included: accounts (password hashes), records, attempts, plans, scenarios, approval evidence, and rule and offering snapshots.
- Left out on purpose: import previews (extracted transcript rows that expire), sessions, and login throttles.

`tests/tooling/test_backup.py` has 8 tests for it. The CI `postgres` job also runs it against a synthetic account, restoring into a separate empty PostgreSQL database. It first passed on GitHub on 3 Nov (runs [41656256493](https://github.com/HarshDhru23/cs437-MADHAM-hack/actions/runs/41656256493) and [41657522345](https://github.com/HarshDhru23/cs437-MADHAM-hack/actions/runs/41657522345), commit `a7b0b41`: "restore verified: counts and revisions match the backup summary").

### 4.3 One student's data: the in-app JSON backup

Under **Account, Your data**, a signed-in student can download `coursepath-backup-<date>.json` (`GET /api/v1/export`). The file holds their accepted record and plans and the rule version; it has no password or session.

Restoring has three steps:

1. Choose the file. `POST /api/v1/imports/backup-preview` checks it and shows what would change.
2. Confirm. `POST /api/v1/imports/<id>/commit` with `confirm: true` replaces the record and adds the backup's plans in one transaction.
3. Check the result. The server-side behaviour is:
   - Only the account that exported the file can restore it.
   - A restore without confirmation is refused.
   - Restored plans get new IDs and start at revision 0.
   - The record revision moves forward; it does not go back.
   - Scenarios are not restored and must be recreated.

This is the student's own copy. It does not back up other accounts or the database.

### 4.4 Rehearsal, 3 Nov, *verified* (synthetic data only)

The run used the current `main` plus this branch, on Windows, in a temporary folder that was deleted afterwards. The account was the synthetic `rehearsal-student`, with a two-course IMS paste of invented `ZZ` courses.

**Database copy (§4.1):**

| Step | Result |
| --- | --- |
| 1. Fresh SQLite database A, migrated, served over real HTTP | ready |
| 2. Sign up, IMS preview and commit, create a plan, edit it once | record revision 1, 2 attempts, plan revision 1 |
| 3. Stop the server; copy A's file to B (249,856 bytes) | copied |
| 4. Start the server with `COURSEPATH_SQLITE_PATH` pointed at B; sign in with the same password | sign-in succeeded |
| 5. Compare B with A | same record revision (1), same 2 attempt IDs, same plan ID and revision (1) |
| 6. Send a stale `PATCH /record` on B | 409, as expected |

**In-app JSON backup (§4.3), on B:**

| Step | Result |
| --- | --- |
| 1. Export before deleting | `coursepath-backup`, version 1 |
| 2. "Delete my data" | record emptied, revision 2, no plans |
| 3. Backup preview | 2 attempts to add, 1 plan to create, no issues |
| 4. Commit without `confirm` | refused (400) |
| 5. Commit with `confirm` | 200 |
| 6. Export again and compare | attempts identical to the first export; plan label and semesters identical (new plan ID, revision 0; record revision 3) |
| 7. Another synthetic account tries to preview the same file | 422 `BACKUP_OWNER_MISMATCH` |

The temporary folder was deleted afterwards. A separate rehearsal of §4.2 also passed on 3 Nov: `dump` from one SQLite database and `restore` into a separate empty one gave the same counts and revisions, sign-in worked, and a stale write still got 409. The browser tests `e2e/tests/student-flow.spec.ts` and `save-states.spec.ts` cover the two-browser case (CP-29) on one server.

## 5. Backup rules for localhost (agreed 3 Nov)

Proposed by Manashree and agreed by Harsh in the review of PR #36. They apply to the team's local databases, not to a host.

1. Back up (§4.1 or §4.2) before every `migrate` and before a demo or user session. Keep the copy until the app has been checked after the change, and for no more than 7 days; then delete it.
2. Use synthetic accounts for development, demos and user sessions. A database or backup that holds a real student's record stays on that student's own machine and account.
3. Keep backups outside the repository, never in Git, CI artifacts, chat or a shared drive. `server/.local/` and `*.sqlite3` are git-ignored; a backup copied elsewhere is not.
4. A backup holds password hashes and every account's records. Delete it like the original when it is no longer needed.
5. "Delete my data" removes data from the running database immediately. A copy made earlier under rule 1 still holds it until that copy is deleted, which rule 1 limits to 7 days. On the hosted site the Azure database also keeps automatic backups for 7 days (geo-redundant backup off), so a deleted account can remain in a backup until it expires; the deletion message says so. Copies taken by hand under rule 1 are the operator's to delete. If the retention setting changes, update the message in `server/api/views.py`, `YourData.tsx` and `server/README.md` together.

## 6. Demo and user sessions

Start from a fresh database (move `server/.local/coursepath.sqlite3` aside, or set `COURSEPATH_SQLITE_PATH` to a new file, then `migrate`). Use only synthetic accounts and inputs: the IMS sample on the import page or the PDF from `e2e/fixtures/make_synthetic_pdf.py`. Say that it runs on localhost. Order and limitations: [docs/demo.md](../demo.md).

## 7. On hold: hosted deployment

Not needed for the localhost release and not a blocker (team, 3 Nov). These are recorded so they are not mistaken for done:

- production web server;
- serving the built UI and deep links from Django;
- HTTPS proxy and CSRF origin settings;
- health-check endpoint;
- host and URL;
- managed PostgreSQL and its backups.

`server.records.test_privacy` still checks the production settings guard (`check --deploy`). If hosting is taken up, this runbook needs a release and smoke-test section before any hosted claim is made.
