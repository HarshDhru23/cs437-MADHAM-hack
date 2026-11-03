# CoursePath operations runbook (M08)

Status 3 Nov 2026, checked against `main` at `43c5d96`. **CoursePath is not hosted.** No host, URL, managed PostgreSQL or production secret exists yet (GAP-13), and the production serving pieces below are not on `main`. Everything marked *verified* was run; everything else is a procedure still to execute.

## 1. What works today

| Item | State | Evidence |
| --- | --- | --- |
| Local run, SQLite | verified | `python scripts/run.py` (Django 8000 + Vite 5173), README |
| Full test command | verified on Windows | `python scripts/test.py` (see `docs/submissions/2026-11-03.md`) |
| PostgreSQL migrations + Django tests | CI job `postgres` | `.github/workflows/ci.yml`; not run locally (no PostgreSQL server on this machine) |
| Production settings guard | test | `server.records.test_privacy` runs `check --deploy --fail-level WARNING` with production settings |
| Backup and verified restore | verified on SQLite; CI step on PostgreSQL | §4 |
| Hosted deploy, HTTPS, cross-device on a shared server | **not done** | no host chosen |

## 2. Production gaps (blocking a hosted release)

Each was searched for in `server/` and `requirements*.txt` on `43c5d96`.

| Gap | Owner | Why it blocks |
| --- | --- | --- |
| No production WSGI server pinned (gunicorn or similar) | Harsh (H14) | `runserver` is not a production server |
| No static-file serving of `frontend/dist` (`STATIC_ROOT`, WhiteNoise or host static) | Harsh + Aaryan (A12) | the built UI has no same-origin route |
| No SPA fallback (non-`/api` paths -> `index.html`) | Harsh + Aaryan | deep links such as `/plan/<id>` 404 on reload |
| No `SECURE_PROXY_SSL_HEADER`, no `CSRF_TRUSTED_ORIGINS` | Harsh | behind a TLS proxy `SECURE_SSL_REDIRECT` loops and CSRF checks fail |
| No `GET /api/v1/health` touching the database | Harsh | host readiness checks and smoke tests have nothing cheap to call; `/api/v1/session` is the stand-in |
| No host, URL or managed PostgreSQL | team (GAP-13) | cross-device persistence (CP-29) cannot be shown hosted |

## 3. Environment (names only; values live in the host's secret settings)

| Name | Meaning |
| --- | --- |
| `COURSEPATH_ENV` | `production` turns DEBUG off and requires PostgreSQL, HTTPS and secure cookies |
| `COURSEPATH_SECRET_KEY` | required in production; start-up fails without it |
| `COURSEPATH_ALLOWED_HOSTS` | comma-separated host names |
| `COURSEPATH_DB_NAME`, `_USER`, `_PASSWORD`, `_HOST`, `_PORT` | PostgreSQL connection |
| `COURSEPATH_DB_ENGINE=postgresql` | development/CI only: use PostgreSQL without production mode |
| `COURSEPATH_SQLITE_PATH` | development/test only: an isolated SQLite file |
| `COURSEPATH_API_ORIGIN` | Vite dev/preview proxy target (default `http://127.0.0.1:8000`) |

See `.env.example`. Never put a real value in Git, CI logs or screenshots.

## 4. Backup and restore

`scripts/backup.py` uses whatever database the environment selects (§3).

```sh
python scripts/backup.py summary                        # counts, revisions, latest migration
python scripts/backup.py dump --out <backup.json>       # versioned file with an embedded summary
python scripts/backup.py restore --input <backup.json>  # into an EMPTY, separate database only
```

`restore` migrates the target, refuses a non-empty database, an unknown backup format or a backup from a newer migration, loads the data and then fails unless every row count and every record/plan/scenario revision equals the summary written at dump time. Included: accounts (password hashes), records, attempts, plans, scenarios, approval evidence, rule and offering snapshots. Excluded on purpose: import previews (extracted transcript rows, expiring), sessions, login throttles.

**Rehearsal, 3 Nov, verified (SQLite):** on a temporary database A, over real HTTP: synthetic signup, IMS paste preview and commit (2 attempts, record revision 1), plan created (revision 0). Server stopped; `dump`; `restore` into a separate temporary database B reported counts and revisions equal. Server started on B: sign-in with the same password succeeded, `GET /record` returned revision 1 with 2 attempts, `GET /plans` returned the same plan ID and revision, and a stale `PATCH /record` still returned 409. Both temporary databases were deleted afterwards. Automated equivalents: `tests/tooling/test_backup.py` (8 tests).

**PostgreSQL:** the CI `postgres` job seeds a synthetic account, dumps, creates `coursepath_restore` and restores into it. This step has **not yet executed** (written on this branch).

Handling rules (proposed; needs team agreement before the first real user):

1. Take a backup immediately before every production migration; keep it until the post-migration smoke test (§5) passes, and at most 7 days.
2. A backup holds personal records and password hashes. Store it only in the host's private storage; never in Git, CI artifacts, chat or a shared drive.
3. An account deleted through `DELETE /account/data` can still exist inside a backup until that backup is deleted. The current deletion message (`server/api/views.py` `RETENTION`) says "this repository configures no database backups"; if rule 1 is adopted, that text must be updated to state the retention period (handoff to Harsh).

## 5. Release procedure (once §2 is closed)

1. `main` green in CI, including the PostgreSQL job. Note the commit SHA.
2. Build: `npm ci --prefix frontend && npm run build --prefix frontend`; `pip install -r requirements.txt`; collect static files.
3. Back up the production database (§4), then `python server/manage.py migrate --noinput`.
4. `COURSEPATH_ENV=production python server/manage.py check --deploy`: no unaccepted warnings.
5. Smoke test on the hosted URL with a fresh synthetic account: sign up -> paste the synthetic IMS sample -> review -> confirm -> audit -> add a course to the plan -> save -> open the same account in a second browser -> reload a deep link -> restart the app process and reload again.
6. Record URL, SHA and smoke-test result in the checkpoint evidence. A local run is not evidence of hosted persistence.

## 6. Demo-day fallback

`python scripts/run.py` on a laptop with a fresh local SQLite database and synthetic accounts (setup in README). Verified to start both servers and stop them cleanly on 27 Oct and again today (§1). It demonstrates the app, not hosted cross-device saving; say so if it is used.

## 7. Account deletion and data

`DELETE /account/data` deletes the owner's attempts, enrolment, controls, plans, scenarios, previews and approval evidence immediately (and the account when asked). Run `python server/manage.py purge_previews` on a schedule in production so expired previews do not accumulate (server/README.md).
