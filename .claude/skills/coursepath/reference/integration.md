# Integration checklist

Every place where one person's output becomes another person's input is a seam. Each seam needs a named producer, a named consumer and an automated check. If a seam has no check, it will drift; add a check instead of relying on memory.

## Seams

| Seam | Producer → consumer | Guarding check | Typical breakage |
| --- | --- | --- | --- |
| JSON schema + examples | Harsh → Aaryan, Manashree | `tests/domain/test_contract.py` validates `examples/*.json` against `schemas/coursepath-v1.schema.json` | Field renamed in Python but not in schema/examples; frontend mock still has old name |
| Live API responses ↔ schema | Harsh → Aaryan | Django tests should validate real endpoint responses against the same schema (add one per route) | Examples validate, but the real endpoint returns a different shape |
| API routes / status codes | Harsh → Aaryan | `server/README.md` route table + Django HTTP tests | Trailing slash, wrong method, 400 vs 422, missing `current_revision` on 409 |
| Frontend TS types ↔ schema | Harsh → Aaryan | Generate types from the schema, or a test that type-checks every `examples/*.json` against `types.ts` | Hand-written `types.ts` silently diverges |
| Timetable snapshot | Manashree `build_snapshot` → Harsh H11 | Snapshot JSON validates against the `OfferingSnapshot` schema; Harsh's loader tests consume a committed synthetic snapshot | Minutes vs "HH:MM", weekday 1-based vs Monday=0, inclusive end dates |
| Reference oracles | Manashree `tests/reference_fixtures/` → Harsh's domain | Reference tests call public domain functions; expected JSON never imports the engine | Expected values regenerated from parser output (not independent) |
| SPEC ↔ tests | Everyone → graders | `preflight.py` resolves every test ID in `schemas/statement-test-map.json` and every `file::Class.method` in SPEC.md | Test renamed/moved; map still points at it; CP looks covered but isn't |
| Django models ↔ migrations | Harsh | `manage.py makemigrations --check --dry-run` (preflight runs it) | Model changed, migration missing; teammate's DB breaks on pull |
| Component commands ↔ root scripts/CI | Harsh, Aaryan → Manashree | `scripts/test.py` asserts known suites actually ran (nonzero counts) | npm script renamed; CI silently runs nothing |
| Frontend build ↔ Django serving | Aaryan → Harsh | Deployed smoke test loads a deep link (`/plan/<id>`) after reload | SPA routes 404 in production; assets under wrong base path |

## Contract conventions (from contracts.md §1 and §7)

- Envelope is always `{"data": ..., "issues": [...], "schema_version": "1"}`. Errors too.
- snake_case fields. Opaque string IDs. Course code is a separate field from ID.
- Credits: decimal strings. Never `parseFloat` for arithmetic in the frontend. Display only.
- Dates `YYYY-MM-DD`; timestamps UTC ISO with offset; display in Asia/Kolkata.
- Term IDs `2026-27-I`, `2026-27-II`, `2026-27-SUMMER`. Row order is never semester order.
- Weekdays Monday=0..Sunday=6; meeting times are minutes since local midnight.
- `null` + issue means unknown. `[]` means verified empty. Do not use one for the other.
- UI behavior keys off `issue.code`, never English message text.
- Routes live under `/api/v1`, **no trailing slashes**.
- Status codes: 400 invalid, 401 unauthenticated, 403 CSRF/forbidden, 404 missing **or foreign-owned**, 409 stale revision (`current_revision`, `reload_compare`), 413 too large, 422 uncommittable import, 429 throttled.

## Session/CSRF handshake (the most common frontend↔backend bug)

1. `GET /api/v1/session` first; it sets the CSRF cookie and returns `csrf_token`.
2. Send `X-CSRFToken` and cookies (`credentials: "same-origin"`) on every mutation.
3. **Login and signup rotate the CSRF token.** Re-bootstrap `/session` (or re-read the cookie) before the next mutation, or the next POST is a 403.
4. Local development: Vite on 5173 proxies `/api` to Django on 8000, so the browser sees one origin. Do not add CORS or `SameSite=None` workarounds.

## Revision protocol

- Every mutation sends `expected_revision`; the response returns the new acknowledged revision.
- Serialize or coalesce saves per resource; never two in-flight PATCHes for the same plan.
- On 409: keep the local draft, show reload/compare, do not retry automatically.
- Discard analysis responses whose `record_revision`/`plan_revision` no longer match the current state.

## Changing a contract safely

1. Write the change as a diff to `contracts.md`/schema first and post it to the other two before coding.
2. One `[contract]` PR updates schema, examples, Python serializers, frontend types/usages and any fixture that uses the shape. Or keep the old field and add the new one, then remove the old one in a later PR.
3. All three suites (domain/Django, frontend typecheck/tests, reference tests) must pass on that PR.
4. Breaking change without a version bump is never acceptable after the frontend consumes the field.

## Branch and merge hygiene

- Rebase daily on `origin/main` while a branch is open; long-lived branches are where integration debt accumulates.
- Before merging: rebase, run full preflight, and if the PR touches a seam above, run the consumer's suite too.
- After merging a seam change, tell the consumer explicitly ("`/plans` PATCH now returns `validation`; A06 can switch off the mock").
