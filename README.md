# CoursePath

CoursePath will help IIT Gandhinagar B.Tech CSE students audit their graduation requirements and plan future semesters with checks they can independently verify. The named initial user is Aayush Kuloor; his feedback and the statements are in [SPEC.md](SPEC.md).

**Status (27 Oct 2026):** the Django backend (`server/`), the Python domain (`coursepath/`) and the React frontend (`frontend/`, browser tests in `e2e/`) are on `main`. The run and test commands drive all of them. Plan and ownership: [docs/team/README.md](docs/team/README.md). Backend API details: [server/README.md](server/README.md).

## Setup

You need Git, **Python 3.12** (CI uses 3.12; 3.13 also works) and **Node.js 24** (`frontend/` and `e2e/` require `>=24 <25`). On Ubuntu/Debian also install `python3-venv`; there the commands below are `python3`.

1. Clone and enter the repository, then create and activate a virtual environment. Activation differs by shell:

   ```sh
   git clone <repository URL> && cd cs437-MADHAM-hack
   python -m venv .venv
   source .venv/bin/activate          # macOS/Linux, and Git Bash on Windows: source .venv/Scripts/activate
   ```

   ```powershell
   .venv\Scripts\Activate.ps1         # Windows PowerShell
   # If PowerShell refuses to run scripts, allow them for your user once:
   #   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   # Windows cmd.exe instead: .venv\Scripts\activate.bat
   ```

2. Install everything and create the local database (with the environment active):

   ```sh
   python -m pip install -r requirements.txt     # exact pinned versions, including openpyxl
   python server/manage.py migrate               # again after every pull that adds migrations
   npm ci --prefix frontend
   npm ci --prefix e2e
   npm run install-browsers --prefix e2e         # Playwright's Chromium, once
   ```

   On Linux, Chromium also needs system libraries: `npm run install-browsers --prefix e2e -- --with-deps` (uses `sudo`; this is what CI runs).

The run and test commands never install anything. No external service or secret is needed locally: SQLite, sessions and a generated development secret live in the git-ignored `server/.local/`. There is no default login; create your own account in the app (below).

Private inputs (a real transcript, IMS paste, timetable or advisory) stay local and git-ignored; never commit them. Optional checks against them are described under Test.

## Run

```sh
python scripts/run.py
```

Starts the Django API on `127.0.0.1:8000` and the Vite dev server on `localhost:5173` (`--api-port`, `--web-port` to override), prints the URL when both answer, and stops both on Ctrl+C, a closed terminal or a termination signal. If setup is incomplete (dependencies missing, `migrate` not run, a port already in use) it exits with code 2 and says what to do. The Vite proxy is pointed at the chosen API port through `COURSEPATH_API_ORIGIN`. These are development servers, not the hosted production setup. The scaffold is still available as `python -m coursepath`.

Then open the printed URL (normally http://localhost:5173):

1. **Requirements** is public: browse the CSE 2024 rules without an account.
2. Choose **Create account**, pick any username and password (stored only in your local database). There is no shared or default account.
3. **Add my record**: paste an IMS grade table, upload a transcript PDF, or use **Use synthetic sample** to try it without personal data. Review the rows, then **Confirm record**.
4. Look at **My record**, **Requirements** (your audit), **Plan** and **Performance**.

Stop `run.py` before running the test command: the browser tests start their own servers on ports 8000 and 4173.

## Test

```sh
python scripts/test.py
```

Prints a per-suite table and exits nonzero if any suite fails or its code is missing:

| Suite | What it runs |
| --- | --- |
| `python` | unittest discovery of `tests/` including nested packages; fails if any test module under `tests/` was never executed |
| `django` | `server/manage.py test server` (includes the live-HTTP API test, which binds loopback sockets) |
| `frontend` | `npm run typecheck`, `test`, `build` |
| `e2e` | `npm run typecheck` and `npm test` in `e2e/`: Playwright against a real Django on a temporary database plus the production frontend build. Needs ports 8000 and 4173 free (`COURSEPATH_E2E_API_PORT=8010` moves the API port); the command passes `COURSEPATH_PYTHON` itself |

`--suite python` (repeatable) narrows a development run; only the full command counts as a checkpoint result. Skipped tests are counted in the table.

Some checks need the real sample files, which are never committed: the transcript PDF, the IMS paste, a hand-transcribed `real_transcript_oracle.json` of them, and the supplied timetable workbook. Keep them in one local folder (the repository root works; all are git-ignored) and point the tests at it:

```sh
COURSEPATH_REAL_INPUT_DIR=/path/to/inputs python scripts/test.py --suite python     # PowerShell: $env:COURSEPATH_REAL_INPUT_DIR = "..."
```

Without those files the real-file tests are skipped, visibly, and their synthetic counterparts still run; CI never has them. On systems where Python is named `python3`, use that name.

## Timetable snapshot

```sh
python scripts/build_timetable.py --input "<timetable.xlsx>" --term 2026-27-I \
    --output data/offerings/2026-27-I.draft.json --report data/offerings/2026-27-I.report.json
```

Read-only; the workbook is never modified. Exit 0 = ok, 1 = bad input, 2 = written but the report lists errors. The output is an unreviewed draft; read the report's issues before handing it to Harsh. Sources and open questions: [docs/data/](docs/data/).

## Statement report

```sh
python scripts/statement_report.py --frontend --browser     # the 27 Oct first-release statements, as CI checks them
python scripts/statement_report.py --all                    # all 34 statements
```

Runs the tests named in `schemas/statement-test-map.json` and shows, per statement, whether all its tests passed, plus separate Browser, Frontend and Local columns. Local checks need the private files and never count towards tests-green. Tests-green is shown separately from release evidence (browser flow, review, merged PR) and is never reported as release-complete. Exit 1 if a statement is not tests-green or a mapped browser or frontend test failed.

## Operations, backup and demo

CoursePath is not hosted yet. Production gaps, environment names, the release procedure and the backup policy are in [docs/operations/runbook.md](docs/operations/runbook.md); variable names (no values) are in `.env.example`.

```sh
python scripts/backup.py summary
python scripts/backup.py dump --out <backup.json>        # contains personal data and password hashes: never commit
python scripts/backup.py restore --input <backup.json>   # only into an empty, separate database; verifies counts and revisions
```

User-test script: [docs/qa/user-test-script.md](docs/qa/user-test-script.md). Demo order and known limitations: [docs/demo.md](docs/demo.md).
