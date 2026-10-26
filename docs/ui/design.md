# CoursePath UI brief (A01)

Owner: Aaryan. Scope: `frontend/`, `e2e/`, `docs/ui/`. Academic decisions come from the Django API; the UI formats and explains them.

## Task hierarchy

1. Requirements (public, `/`): the full CSE 2024 requirement tree grouped by basket, before sign-in or history. Rule version and review status are always visible.
2. My record (`/record`, `/record/import`, `/record/review/:preview_id`, `/performance`): import, review, confirm, then the accepted record and current enrolment.
3. Plan (`/plan/:plan_id`): semester table through semester 8, extend action, server validation.
4. Secondary: Performance, Awards, Scenarios, Account (tabs under the main areas, not first-run tasks).

The flow stays requirements-first: `Explore requirements -> Import -> Review -> Analyze -> Plan`.

## Layout sketches

Desktop (1440px):

```text
+---------------------------------------------------------------+
| CoursePath  Requirements | My record | Plan        user ▾      |
| Context: CSE 2024 · rule cse-2024-draft-v1 (draft) · Actual    |
+---------------------------------------------------------------+
| Secondary tabs (Record / Performance ...)                      |
| Main table / form (max 72rem)          | Explanation panel     |
|                                        | (sources, Why?)       |
+---------------------------------------------------------------+
```

Mobile (390px): header with menu toggle, context line wraps under it, single column. Tables become stacked rows (each row is a labelled card) rather than horizontal scroll; explanations open in a bottom drawer.

## Tokens (`frontend/src/styles/tokens.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f7f5f1` warm neutral | Page background |
| `--surface` | `#ffffff` | Panels, tables |
| `--text` | `#1d232b` | Body text (contrast > 14:1 on bg) |
| `--text-muted` | `#4c5562` | Secondary text (> 7:1) |
| `--accent` | `#0d5c63` deep teal | Primary actions, links, focus |
| `--success` / `--warning` / `--danger` / `--unknown` | `#1f6b3a` / `#8a5300` / `#a32020` / `#4a4f8c` | Status, always with text + icon |
| `--font` | system UI sans stack | Single family |
| `--font-size` | `1rem` (16px) | Body |
| `--target` | `44px` | Minimum control height/touch target |
| Numbers | `font-variant-numeric: tabular-nums` | Credits, CPI |

Focus is a 3px teal outline with offset; never removed. Motion is limited to short transitions and disabled under `prefers-reduced-motion`. No decorative charts.

## Status language

Requirement status (`satisfied`, `pending`, `conditional`, `needs_review`) and issue severity (`error`, `warning`, `unknown`, `approval_required`) always render as text plus a symbol. Unknown values show `Unknown`/`Unavailable` with the server's reason, never `0` or a green check. Progress bars only illustrate counted/required strings from the server; status labels never derive from bar length.

## Screen/state checklist

| Screen | Empty | Loading | Error | Unknown/partial | Notes |
| --- | --- | --- | --- | --- | --- |
| Requirements (public) | n/a | yes | yes | draft rules + missing sources banner | Before login |
| Requirements (personal) | no record → import link | yes | yes | needs_review rows, excluded attempts | actual/current/projected control |
| Import | no input | parsing | parse/limit/auth errors | unparsed rows | paste/PDF equal tabs |
| Review | no candidates | yes | expired/foreign preview restart | issues-first filter | Import→Review→Analyze |
| Record | no attempts → import | yes | yes | unresolved classification | completed vs current enrolment |
| Plan | no plan → create | yes | yes | prerequisites/offerings unknown | save status, undo, keyboard move |
| Performance | no graded attempts | yes | yes | display value unavailable + reason | server values only |
| Account | n/a | n/a | password errors | export/delete not yet served | no SSO/recovery buttons |

## Responsive/accessibility checks

390px, tablet (768px) and 1440px; keyboard-only primary flow; 200% zoom; landmarks, labelled controls, focus order = reading order; no drag-only action; no real student identifiers in screenshots.

## Commands (handoff to Manashree)

From `frontend/` (Node 24 LTS):

- `npm ci` — install pinned dependencies from `package-lock.json`.
- `npm run dev` — Vite on `http://127.0.0.1:5173`, proxying `/api` to `http://127.0.0.1:8000` (override with `COURSEPATH_API_ORIGIN`).
- `npm run dev:mock` — development-only synthetic API with a visible banner; never used by `build`.
- `npm run typecheck`, `npm test` (Vitest, single run), `npm run build` (production bundle in `frontend/dist/`, no mock code).
- `npm run preview` — serves `dist/` on `http://127.0.0.1:4173` with the same `/api` proxy and SPA deep-link fallback.

Browser acceptance is a separate package in `e2e/` (`npm ci`, `npm run install-browsers`, `npm test`); see `e2e/README.md`.
