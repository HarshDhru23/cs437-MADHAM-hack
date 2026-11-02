# CoursePath browser acceptance (A10)

Playwright tests that start the **real** stack: Django API on `127.0.0.1:8000` with a fresh temporary SQLite database, and the production frontend build served by `vite preview` on `127.0.0.1:4173` (proxying `/api`, SPA fallback for deep links). Nothing is mocked.

## Setup (once)

```powershell
# Backend (see server/README.md): Python 3.12 venv with requirements.txt installed.
cd frontend; npm ci; cd ..
cd e2e; npm ci; npm run install-browsers; cd ..
```

## Run

```powershell
cd e2e
$env:COURSEPATH_PYTHON = (Resolve-Path ..\.venv\Scripts\python.exe)   # interpreter with backend deps
npm test
```

Environment variables:

- `COURSEPATH_PYTHON` — Python with the backend requirements (default `python`). Also used to generate the synthetic PDF fixture (needs `reportlab`).
- `COURSEPATH_BACKEND_DIR` — checkout containing `server/manage.py` (default: this repository root, which has Harsh's merged `server/` since `a51399e`).
- `COURSEPATH_REAL_INPUT_DIR` — optional local directory holding the two supplied private inputs (same convention as `tests/imports/test_private_inputs.py`). Only `private-inputs.spec.ts` reads it; without it that spec is skipped.

Ports 8000 and 4173 must be free; if 8000 is taken, set `COURSEPATH_E2E_API_PORT` (for example `8010`) and the preview proxy follows it. Django throttles account actions to 10 per IP per 15 minutes; the default suite uses all 10 on its fresh database (the two PDF tests share one account), so retries are disabled and a new spec must reuse an account rather than sign up again. Run the private check on its own so it gets a fresh database and budget:

```powershell
$env:COURSEPATH_REAL_INPUT_DIR = 'D:\private-inputs'   # any local folder outside the repository
npx playwright test private-inputs
Remove-Item Env:COURSEPATH_REAL_INPUT_DIR
```

That spec turns traces, screenshots and video off; its expected values are the roadmap section 4.4 controls, not parser output. `npm run typecheck` checks the test sources.

## Coverage

| Spec | Flow (aaryan.md A10) | CP |
| --- | --- | --- |
| `public.spec.ts` | 1. Public requirements before login; deep-link reload | CP-01 |
| `student-flow.spec.ts` | 2. Signup → IMS paste → review/correct → confirm → audit → plan add/keyboard move → save → second context; 7. 409 conflict, expired session keeps import draft; 8. second account cannot open the plan, sign-out clears state | CP-02, 04, 05, 07, 08, 10, 12, 13, 15, 16, 29, part of 32 |
| `pdf-import.spec.ts` | 3. Synthetic supported-layout PDF → 4 semesters → source totals → idempotent re-import; unreadable file keeps that saved record | CP-06, 09, 11, 12 |
| `account-data.spec.ts` | 8. Backup download (own username and attempts, no password) → delete data with a wrong then the right password → restore the downloaded backup (server diff, explicit confirm) → printable report (print media, 390 px) → delete the account (signed out) → another account sees nothing and cannot restore the backup | CP-30, 32 |
| `reimport-conflict.spec.ts` | 3. Changed grade on re-import → required decision → accept with reason / keep saved, no duplicate attempt, readable re-import history; 7. import commit after another tab saved → 409, record untouched | CP-11, 13, 29 |
| `save-states.spec.ts` | 7. Offline plan edit kept as unsaved draft → explicit retry → saved and reloaded; 2. confirmed current enrolment + sections saved on one device, loaded with the same revision on another | CP-02, 04, 29 |
| `private-inputs.spec.ts` (opt-in) | 3. Supplied PDF → 39 rows (10/10/10/9; 28/22/28/26; reported 104) → commit → 849 points / 92 performance credits, never 105; IMS paste → 40 rows (28/23/28/26; 105 raw) with SC 372 as the one new reviewable row | CP-06, 07, 12, 15 |
| `responsive.spec.ts` | 390 / 768 / 720 (200% zoom of 1440) / 1440 px, reduced motion, skip link and focus order, keyboard tabs | CP-31 (automation part) |

Not yet covered (blocked or later scope): committed anonymized 39-row/40-row oracles for CI (need Manashree's independent fixtures; the private spec is local-only), sections/clashes (flow 4, A08), awards and internship scenarios (flows 5–6, A09) and an observed human session for CP-31.
