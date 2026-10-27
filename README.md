# CoursePath

CoursePath will help IIT Gandhinagar B.Tech CSE students audit their graduation requirements and plan future semesters with checks they can independently verify. The named initial user is Aayush Kuloor; his feedback and the statements are in [SPEC.md](SPEC.md).

**Status (27 Oct 2026):** the Django backend (`server/`), the Python domain (`coursepath/`) and the React frontend (`frontend/`, browser tests in `e2e/`) are on `main`. The run and test commands drive all of them. Plan and ownership: [docs/team/README.md](docs/team/README.md). Backend API details: [server/README.md](server/README.md).

## Setup

Python 3.12 is the repository target (the tests are also run on 3.14). Node 24 (`frontend/` and `e2e/` require `>=24 <25`).

```sh
python -m venv .venv
.venv/Scripts/activate        # PowerShell: .venv\Scripts\Activate.ps1   |   macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install openpyxl           # timetable adapter; not yet in requirements.txt (request open with Harsh)
python server/manage.py migrate          # first run only; creates the local SQLite database
npm ci --prefix frontend
npm ci --prefix e2e
npm run install-browsers --prefix e2e    # Playwright's Chromium, once
```

The run and test commands never install anything. No account, external service or secret is needed locally: SQLite, sessions and a generated development secret live in the git-ignored `server/.local/`.

Private inputs (a real transcript, IMS paste, timetable or advisory) stay local and git-ignored; never commit them. Optional checks against them are described under Test.

## Run

```sh
python scripts/run.py
```

Starts the Django API on `127.0.0.1:8000` and the Vite dev server on `localhost:5173` (`--api-port`, `--web-port` to override), prints the URL when both answer, and stops both on Ctrl+C. If setup is incomplete (for example `npm ci` not run) it exits with code 2 and lists what is missing. The Vite proxy is pointed at the chosen API port through `COURSEPATH_API_ORIGIN`. These are development servers, not the hosted production setup. The scaffold is still available as `python -m coursepath`.

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
| `e2e` | `npm test --prefix e2e`: Playwright against a real Django on a temporary database plus the production frontend build. Needs ports 8000 and 4173 free; the command passes `COURSEPATH_PYTHON` itself |

`--suite python` (repeatable) narrows a development run; only the full command counts as a checkpoint result. Skipped tests are counted in the table.

To also run the checks against the real sample files (Python tests and the opt-in browser spec), point the tests at the directory holding them. The Python tests default to the repository root; the browser spec needs the variable:

```sh
COURSEPATH_REAL_INPUT_DIR=/path/to/inputs python scripts/test.py --suite python     # PowerShell: $env:COURSEPATH_REAL_INPUT_DIR = "..."
```

Without those files the real-file tests are skipped, and the synthetic ones still run. On systems where Python is named `python3`, use that name.

## Timetable snapshot

```sh
python scripts/build_timetable.py --input "<timetable.xlsx>" --term 2026-27-I \
    --output data/offerings/2026-27-I.draft.json --report data/offerings/2026-27-I.report.json
```

Read-only; the workbook is never modified. Exit 0 = ok, 1 = bad input, 2 = written but the report lists errors. The output is an unreviewed draft; read the report's issues before handing it to Harsh. Sources and open questions: [docs/data/](docs/data/).

## Statement report

```sh
python scripts/statement_report.py [--all]
```

Runs the tests named in `schemas/statement-test-map.json` and shows, per statement, whether all its tests passed. Tests-green is shown separately from release evidence (browser flow, review, merged PR) and is never reported as release-complete.
