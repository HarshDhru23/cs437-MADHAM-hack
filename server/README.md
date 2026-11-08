# CoursePath backend handoff

This backend covers Harsh's October 27 implementation slice. The root README is
still the historical scaffold setup; Manashree owns its integration update.
Frontend/browser acceptance and reviewed academic datasets remain dependencies.
The API serves a draft 170-credit requirement tree with visible gaps. It does
not certify graduation, course equivalences, honours or an AI minor.

## Setup

Use Python 3.12 (also exercised on 3.13). From the repository root, create an
isolated environment, install the complete pinned dependency set and migrate:

```powershell
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python server/manage.py migrate
.venv/Scripts/python server/manage.py runserver 127.0.0.1:8000
```

On Unix, use `python3.12 -m venv .venv` and `.venv/bin/python` instead. SQLite,
sessions and a generated local secret live in ignored `server/.local/`. No
external service credentials are required. Accounts are created through signup;
there is no default account/password. The server exposes JSON, not a student UI.

```powershell
.venv/Scripts/python -m unittest discover -s tests -v
.venv/Scripts/python server/manage.py test server.records -v 2
.venv/Scripts/python server/manage.py check
.venv/Scripts/python server/manage.py makemigrations --check --dry-run
```

The Django command includes the real HTTP test: independent cookie jars, actual
server processes, an isolated temporary SQLite database and a process restart.
It needs permission to bind/connect to loopback sockets. It is an API integration
test, not evidence that Aaryan's student interface exists or was browser-tested.

Optional private-input verification (never required by CI):

```powershell
$env:COURSEPATH_REAL_INPUT_DIR = (Get-Location).Path
.venv/Scripts/python -m unittest tests.imports.test_private_inputs -v
Remove-Item Env:COURSEPATH_REAL_INPUT_DIR
```

That directory must contain the two supplied PDF/IMS files. Without it, this
one test explicitly skips. Private originals, rendered inspection images and
extracted rows are not fixtures or committed outputs. The test checks the
independent numeric controls already in the committed roadmap, not a fabricated
row-by-row oracle. Manashree's independent row oracle remains required.

## API integration

All routes use `/api/v1`, without trailing slashes. JSON envelopes contain
`data`, `issues`, `schema_version: "1"`. Credit values are decimal strings.
Call `GET /session` first; send its `csrf_token` as `X-CSRFToken` and include
session cookies on mutations. Login/signup rotate the CSRF cookie: bootstrap
the session again or read the current cookie before the next mutation. Use a
same-origin frontend or a Vite proxy. No CORS/cookie workaround is needed.

Implemented routes:

| Route | Behavior |
| --- | --- |
| `GET /session` | CSRF bootstrap; authenticated account or null. |
| `POST /auth/signup`, `/auth/login` | `{username,password}`; Django passwords/sessions; 10 account attempts/IP/15 minutes. |
| `POST /auth/logout` | Invalidate the session. |
| `POST /auth/password` | `{old_password,new_password}`; retains this session, invalidates other old-password sessions. |
| `GET /curricula/cse-2024`, `/catalogue` | Draft tree and explicit empty/unknown catalogue; no approved-data claim. |
| `GET /record` | Owned attempts, profile, current enrolment, revision and source-reported controls. |
| `PATCH /record` | `{expected_revision,attempts?,current_enrolment?,correction_justifications?}`; transactional full-list edits. Corrected existing rows need a justification keyed by attempt ID. Original evidence/history and profile/cohort changes are rejected. |
| `POST /imports/preview` | JSON `{kind:"ims",text,expected_revision}` or multipart `file` + `expected_revision`. No accepted-record mutation. |
| `POST /imports/{id}/commit` | `{expected_revision,accepted_candidate_ids,resolutions}`; explicit selection and atomic commit. |
| `GET/POST /plans` | Owned list/create. Create accepts `{label?,semesters}`. |
| `GET/PATCH/DELETE /plans/{id}` | Owned lookup; PATCH/DELETE require `expected_revision`. PATCH accepts full plan payload. |
| `POST /plans/{id}/validate` | `{record_revision,plan_revision}`; no mutation. |
| `POST /analysis` | `{record_revision,plan_id?,plan_revision?,award_ids?}`; actual/current/projected audit, metrics and plan validation. Awards remain unsupported with an explicit policy issue. |
| `GET /offerings?term_id=2026-27-I` | Public. Timetable snapshot for that term with coverage, review status, meeting groups and source cells: the latest staff-loaded reviewed snapshot, else the committed official one (`data/offerings/`, D-22), else the latest draft; `coverage: "unknown"` and `OFFERING_UNKNOWN` when there is none. |
| `GET /calendar` | Public. The committed academic calendar (`data/calendars/`, D-24): terms with classes, quads, exam windows, make-up exams, recess and events, all end-exclusive, plus `internship_presets` (D-25). Always carries `CALENDAR_MISSING` for the unpublished later years. Example: `examples/calendar.json`. |
| `GET/POST /scenarios` | Owned list (`{scenarios:[...]}`) / create `{plan_id,label?,changes?,internship?,award_ids?}`. The baseline record, plan and rule revisions are captured at creation. |
| `GET/PATCH/DELETE /scenarios/{id}` | PATCH/DELETE need `expected_revision`; PATCH with `rebase: true` moves the baseline to the current record and plan. |
| `POST /scenarios/compare` | `{scenario_ids:[1-6, same plan]}`; for each, baseline and scenario evaluations (audit, labelled hypothetical performance, plan validation, internship) and their deltas. Stale scenarios return `stale: true` and `SCENARIO_STALE`, no evaluation. `internship_cases` tabulates none / 3 / 6 month choices. |
| `POST /scenarios/{id}/apply-plan` | `{expected_scenario_revision,expected_plan_revision}` (both required; the scenario revision is the one the client compared). Writes drop/postpone/replace edits to the saved plan only and returns `{plan,not_applied}`; `not_applied` lists hypothetical fail/grade/cap/internship changes. Never changes the record. Errors are listed below the table. |
| `GET /export?kind=json` | Owned backup download: `kind: "coursepath-backup"`, `backup_version: "1"`, account username, rule version/review status/sources/missing sources, grading policy ID, record (with revision), plans and scenarios. No password, session or CSRF data. |
| `POST /imports/backup-preview` | `{expected_revision, backup}` (the downloaded envelope or its `data`); validates version (the envelope's `schema_version` must be `"1"`), owner, cohort, attempts, reported controls (decimal strings only) and plans, and returns a diff. Restored rows follow the `PATCH /record` rules: a row already in the record keeps its evidence, server-assigned fields and whole correction history and may only append justified corrections; a new row must match its `original` source values except where a justified correction says otherwise, claims no `course_version_id`, and cites only this owner's verified approval evidence. Otherwise 422 `BACKUP_INVALID` with the row IDs in `entity_refs`, and nothing changes. Plans that still exist (same ID or identical content) are not copied again; the diff lists them in `plans_skipped_existing`. Scenarios are not restored (they need an exact baseline). Commit with `POST /imports/{id}/commit` `{expected_revision, confirm: true}`; the record and new plans commit in one transaction. |
| `DELETE /account/data` | `{expected_revision, password, confirm: "delete my data", delete_account?}` (`delete_account` is a JSON boolean; anything else is 400). A Google-only account (D-46) has no password and sends `google_credential` (a fresh Google ID token for its own IITGN address, checked like `POST /auth/google`; 503 `SIGN_IN_UNAVAILABLE` if Google is unreachable) instead. Re-authenticates (403 `REAUTH_FAILED`; re-checks share the login limit, then 429 `AUTH_THROTTLED` and nothing is deleted), then deletes the owner's attempts, current enrolment, reported controls, plans, scenarios, import previews and approval evidence; with `delete_account: true` also deletes the account and ends every session. A staff account that verified other students' approval evidence is not deleted: 409 `ACCOUNT_HAS_VERIFICATIONS`, nothing deleted and the session kept. Returns counts and the retention statement. |

Apply-plan errors, checked in this order; each changes nothing:

- 404 `NOT_FOUND`: missing or foreign scenario.
- 400 `INVALID_INPUT`: either expected revision is missing or not a nonnegative integer.
- 409 `REVISION_CONFLICT`, data `{current_revision,action:"reload_compare"}`: `current_revision` is the scenario's revision when the scenario changed since it was compared, otherwise the plan's revision when the plan is stale. Reload, compare again, then apply.
- 409 `SCENARIO_STALE`, data `{action:"rebase",scenario_revision,current_record_revision,current_plan_revision,current_rule_version,baseline_record_revision,baseline_plan_revision,rule_version}`: the record, plan or rules moved since the scenario's baseline. PATCH the scenario with `{expected_revision:scenario_revision,rebase:true}`, compare again, then apply.

Examples: `examples/scenario.json`, `scenario-comparison.json`, `plan-apply.json`, `scenario-stale.json`.

An empty plan has `semesters: []`. Each semester has `term_id`, `courses`,
`placeholders`; every item has a stable `id`. Selected courses have
`normalized_code`, `credits`, optional version/offering/section/instance IDs.
Placeholders have `requirement_id`, `desired_credits`, optional label. Load
validation includes placeholders in target workload but reports them separately.
PATCHing the full plan supports add/remove/move and revalidates downstream items.
Validation reads the stored snapshot for each planned term. Per course it returns
`offering_status` (`confirmed_in_snapshot`, `tentative` for a draft snapshot,
`not_offered` only when a reviewed snapshot is complete, `historical`, `unknown`)
and `meeting_check_status`; `meeting_checks[term]` lists each clash with both
meeting IDs, planned item IDs and source cells. A clash is `certain: false`
(severity warning) when a meeting's active dates are not stated or it belongs to
an alternative/unstated group. Pick a meeting with `section_ids` (snapshot meeting
IDs) and a source variant with `offering_id`; an `offering_id` missing from the
snapshot is an `OFFERING_VARIANT_UNKNOWN` error. Terms without a snapshot, empty
terms, unresolved slots and placeholder selections are `not_checked`, never `clear`. No future
timetable is inferred, and an offering's credits never overwrite earned history.

Import correction shape, keyed by candidate ID:

```json
{"candidate-id":{"fields":{"title":"Correct extraction"},"justification":"Checked source row"}}
```

Conflicting re-imports additionally use `action: "keep_existing"` or
`action: "accept_incoming"` (the latter requires justification). Corrections
preserve original fields and history. They do not approve equivalence. Repeated
same-term course rows require reviewed distinct `instance_id` corrections or
explicit omission through `accepted_candidate_ids`. Malformed rows require
`resolutions._unparsed: {action:"omit",justification:"..."}`; total discrepancies
require `_totals: {action:"acknowledge",justification:"..."}`. Neither action
forces totals to agree or makes credits degree-eligible.

PDF limits: 10 MB, 20 pages, 10 seconds in a killable extraction subprocess.
PDF bytes stay in memory; Django upload handles are closed on every path.
Paste limit: 1,000,000 characters. Previews expire after one hour and are owner
protected. Expiry blocks commits. Each new import or backup preview deletes that owner's expired
previews; run `manage.py purge_previews` on a schedule in production to delete
all expired ones.

Supported errors: 400 invalid fields, 401 authentication, 403 CSRF, 404 foreign/
missing objects, 409 stale revision, 413 upload limit, 422 uncommittable import,
429 account throttling. A 409 contains `current_revision` and `reload_compare`
(except apply-plan's `SCENARIO_STALE`, which asks for a rebase);
do not automatically overwrite/retry. Self-service account recovery is not
offered: no recovery email is configured, so no reset action is shown. The printable report is the frontend's print
view of `POST /analysis`; the server does not render PDFs.

Scenario changes: `{op:"drop"|"fail"|"grade",item_id}`, `{op:"postpone",item_id,term_id}`
(later terms only), `{op:"replace",item_id,course:{normalized_code,credits}}`,
`{op:"cap",term_id,credits}`. `grade` takes a letter grade: a passing grade keeps the
course planned, so audit and validation are unchanged and only the labelled CPI uses
it; E or F removes the course like `fail`. A graded or failed item takes no further
changes. Internship:
`{duration_choice,start_date,end_date_exclusive,placement_mode,preset?,modules?}`;
modules are `{id,credits,intended_allocation,status,grade?,quad_id?,approval_ref?,registration_id?}`.
A module cannot carry an approval status: only staff-verified `ApprovalEvidence`
covering it approves it. A completed module without `registration_id` may be an
IN 498 attempt already on the record, so (up to the number of unmatched record
attempts) it is not counted toward the 16-credit cap again and raises
`INTERNSHIP_RECORD_MATCH_UNKNOWN`. Internship cases are checked against the committed
2026-27 calendar; courses in later terms, which have no published dates, are listed
as unchecked with `CALENDAR_MISSING`. Plan validation of a later I or II term shows a
same-parity `historical` hint (D-23) and never checks its clashes.

## Rules and deployment configuration

`load_rules path/to/curriculum.json` validates applicability, version, sources,
IDs and component totals before storage. `--draft` permits explicitly unapproved
data; it does not approve it. Reviewed snapshots are immutable through the
normal model save path. Student endpoints cannot ingest/verify rules or approvals.
The committed dataset `cse-2024-v1` is reviewed from ADV13 (cited by page and
SHA-256; the PDF stays local) and the TEAM decisions in `docs/academic-decisions.md`.
Code-prefix membership is used only where a decision says so (D-06 CS electives,
D-19 HS/GE, D-20 basic science). PE needs four passed PE courses; the viva needs a
P in every active regular semester (D-16). Imported rows default to degree
learning (D-21).

`load_offerings snapshot.json --reviewed|--draft [--coverage complete|partial|unknown]`
stores a snapshot produced by `scripts/build_timetable.py` after the adapter's
structural check. One of `--reviewed` (staff checked it against the workbook) or
`--draft` is required; a stored version is never overwritten. The version ID is a
SHA-256 of the stored snapshot's content, so a corrected snapshot of the same
workbook is a new version while reloading an identical one is refused. The term
ID must be a valid academic term.

Committed reference data needs no load step. `data/offerings/2026-27-I.json` and
`2026-27-II.json` are built from the official timetables in the repository root
(D-22); after a source changes, rebuild them with
`python -m coursepath.data_sources.official_timetables` and commit the result (a
test fails if the committed files and the sources drift apart).
`data/calendars/2026-27.json` is the published calendar (D-24). Settings
`COURSEPATH_OFFERINGS_DIR` and `COURSEPATH_CALENDAR_DIR` point at them; `None`
switches a source off.

For production set `COURSEPATH_ENV=production`, `COURSEPATH_SECRET_KEY`,
`COURSEPATH_ALLOWED_HOSTS` (comma separated), and `COURSEPATH_DB_NAME`,
`COURSEPATH_DB_USER`, `COURSEPATH_DB_PASSWORD`, `COURSEPATH_DB_HOST`, optional
`COURSEPATH_DB_PORT`. Production requires PostgreSQL and HTTPS/secure cookies;
configure the actual proxy and production WSGI server with the hosting team.
`COURSEPATH_DB_ENGINE=postgresql` allows PostgreSQL testing in development.
`COURSEPATH_SQLITE_PATH` selects an isolated development/test database only.
Never set production credentials in committed files. `server.records.test_privacy`
runs `check --deploy --fail-level WARNING` under production settings and checks
that DEBUG is off, cookies are secure and a missing secret key stops start-up.
Data deletion is immediate in the application database; this repository
configures no database backups, so any copy the host keeps is outside its
control (the deletion response says so). PostgreSQL concurrency, production
serving and hosting are not yet verified here (GAP-13).
