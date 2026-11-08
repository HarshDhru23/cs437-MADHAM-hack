# CoursePath: working context and handoff

Written so another agent (or person) can continue if this session ends. **Keep the "Redesign tracker" section current** after every step: change a status, add what was learned, add the next step. Last update: 8 Nov 2026 (Harsh's session).

Read in this order: this file, `CLAUDE.md`, `.claude/skills/coursepath/SKILL.md`, then the sources of truth named there (`docs/team/README.md`, `docs/team/contracts.md`, `SPEC.md`, `docs/academic-decisions.md`).

## 1. Where things are

- **Product:** CoursePath, IITGN B.Tech CSE 2024-entry degree audit and planner. Team: Harsh (engine/API/integration), Aaryan (UI), Manashree (timetables, tests, ops). This session works as Harsh.
- **Repo:** `C:\Users\harsh\cs437-MADHAM-hack`. **Branch: `feature/harsh-h15-plan-generator-fixes`** (cut from `feature/harsh-h14-azure-hosting`). **Nothing is committed**: ~175 changed/new files sit in the working tree (hosting, unknown-removal, plan generator, UI cleanup, online credits, redesign). Harsh said PRs come later; ask how to split commits before committing (hosting / unknowns+generator / UI cleanup / redesign). Never `git add .`; never commit the private files (transcript PDF, IMS paste `copied_input.txt`, graduation plan xlsx), `server/.local/`, `.env`. Branch names never contain "claude" or "codex".
- **Live site:** https://coursepath-iitgn.azurewebsites.net (Azure App Service B1 Linux, Python 3.13, gunicorn + WhiteNoise; PostgreSQL Flexible Server `coursepath-db-isc` in indiasouthcentral; resource group `coursepath-rg`; runbook `docs/operations/azure.md`). Last deployed release: everything up to and including online credits, plan name/reset/lighten, hypothetical-changes search (before the redesign). The redesign is NOT deployed yet.
- **Deploy:** `az login` is already valid on Harsh's machine (IITGN tenant needs MFA if it expires). Then from the repo root:
  - `.venv/Scripts/python scripts/package_azure.py` (zip of tracked + untracked-not-ignored files plus `frontend/dist`; build the frontend first: `npm run build` in `frontend/`, the full test run does it)
  - `az webapp deploy --resource-group coursepath-rg --name coursepath-iitgn --src-path coursepath-azure.zip --type zip --timeout 600`
  - wait for `https://coursepath-iitgn.azurewebsites.net/api/v1/health` = 200 (cold start can take ~100 s), then `.venv/Scripts/python scripts/smoke_live.py` (creates and deletes a synthetic account; every line must PASS).
- **Python:** always the project venv: `.venv/Scripts/python` (Windows). Files use CRLF; edit with exact-match tools, never blind `sed -i` on multi-line text.

## 2. Test and run commands

- All suites: `.venv/Scripts/python scripts/test.py` (python, django, frontend typecheck+vitest+build, e2e). Narrow: `--suite python|django|frontend|e2e`. Last full run before the redesign: python 422, django 76, frontend 472, e2e 46 (1 skipped), all green.
- Frontend only (from `frontend/`): `npx tsc -b`, `npx vitest run`, `npm run build`.
- E2E on custom ports (so nothing collides with a running dev stack): see how `e2e/playwright.config.ts` reads env overrides; each redesign fork used its own port pair.
- Local stack: `.venv/Scripts/python scripts/run.py [--api-port N --web-port M]` (Django + Vite). Local dev account `localtester` holds the author's REAL record in the git-ignored local DB (never copy its contents into code, tests, fixtures or reports).
- Statement map check after renaming tests: `.venv/Scripts/python -m unittest tests.domain.test_statement_map` (mapped titles in `schemas/statement-test-map.json` must exist; frontend tests are under `frontend_tests`, browser under `browser_tests`).
- Preflight before a PR: `.venv/Scripts/python .claude/skills/coursepath/scripts/preflight.py` (full) / `--quick`. Last quick run: 0 fail, 2 warn (edits in Aaryan's/Manashree's files and shared docs: they must agree before a PR).

## 3. What was built before the redesign (all uncommitted, all deployed)

- **Hosting:** Azure runbook, health endpoint, WhiteNoise SPA serving, packaging script, smoke script.
- **Unknown-removal:** decisions D-26 to D-35 in `docs/academic-decisions.md`; real catalogue; rule-based import matching; informational notes instead of unknowns.
- **Plan generator** (`coursepath/plan_generation.py`, `coursepath/online_credits.py`, `POST /plans/generate`, `POST /plans/check`): packs semesters to 28 credits (D-36), internship semester with 4-credit modules split over what is still open (D-37, D-40), open-ended electives held as labelled credits, later years follow the 2026-27 odd/even timetables (D-38), online credits (up to 16) in summer breaks only when they save a semester (D-41), online courses by hand incl. HSS, per-requirement "credits left", lighten with online credits (D-42), UI-has-no-internal-text rule (D-39). Contract: `docs/team/contracts.md`, `schemas/coursepath-v1.schema.json`, `examples/`.
- **UI (before redesign):** requirements page with expandable groups and a "Not yet eligible to graduate" verdict; plan page and generated-plan editor (name, reset, add course/elective/online course, live load/credits-left numbers, plain problems); delete plans/scenarios; course picker filtered by requirement and semester; scenario fixes and searchable planned-course picker.
- **Known follow-ups not done:** standing/advisor-cap profile UI; ~38/25 unrecognised timetable rows; prerequisites recorded for only ~22 courses; Azure DB backup/restore not rehearsed; generation time on Azure with the real record not measured (client has a 45 s timeout); leftover empty `smoke-…` accounts on the live DB; Python messages for plan issues still mention "CoursePath team" wording in places (the UI strips it).

## 4. Redesign tracker: "CoursePath Mission Control"

### Decisions (Harsh, 8 Nov 2026, final)
- Whole-UI redesign, concept in `docs/design/mission-control-concept.html` (also published privately: https://claude.ai/artifact/GmykAzDhSezVHctFCcHCSU). Read it for the visual language.
- **Dark theme is the default**, regardless of the OS setting; light is only an optional toggle (stored in `localStorage` key `coursepath-theme`, applied as `data-theme` on `<html>` before first paint).
- **Palette is fixed** in `frontend/src/styles/tokens.css`: bg `#0a0e16`, bg2 `#0f1520`, panel `#131b29`, line `#243349`, grid `#162133`, fg `#e8eef7`, muted `#8fa2ba`, accent (cyan, your progress) `#52d3f5`, ok (mint, done) `#4be3b5`, warn (amber, limits) `#ffb454`, bad (red, problem) `#ff6b85`, whatif (violet) `#c99bff`. Tints only via `color-mix` on these tokens. No other colours, no gradients or glow (focus ring excepted). Old token names (`--surface`, `--border`, `--text`, `--success`, `--warning`, `--danger`, `--scenario` ...) alias the new ones so old components restyle automatically.
- Fonts (self-hosted via `@fontsource`, no third-party requests): Chakra Petch (display/headings), IBM Plex Sans (body), JetBrains Mono (codes, credits, numbers, tabular).
- **No prerequisite map.** **No awards/achievements/milestone badges anywhere**: the Awards tab, route and page are removed (`/awards` becomes "page not found").
- **No fake or invented data** (no fake log streams, no made-up numbers): everything on screen is a real server number; the UI formats, and may cap a counted value at its required value only for drawing.
- The earlier rules still apply: student-facing wording only (no decision ids, issue codes, rule/source text, revision numbers, "unknown" jargon; `info` severity never shown), semester limit 28 (summer 10).

### Features in scope
1. Tokens, fonts, base element styles, utility classes (`.panel .panel-head .section-label .mono .num .tag .meter .chip .chip--placeholder .pill-ok/.pill-warn/.pill-bad/.pill-whatif .problem-list .readout .grid-board .heat`), print stays black on white.
2. App shell: wordmark `>_ CoursePath`, nav tabs, account chip, theme toggle, "Search or jump to… /" button.
3. **Command bar** (Ctrl/Cmd+K and `/` outside fields): navigation, "Generate a plan" (`/plan?generate=1`, plan screen starts generation once and clears the param), theme switch, sign in/out. Only real commands.
4. **Degree ring** on Requirements (arc per top-level group, centre = counted of 170 from `audit.degree`), build-status verdict, dense group rows with meters, segmented view switch.
5. Record (stat tiles, dense semester tables), **Performance** (CPI readout + per-term SPI sparkline), Import/Review stepper.
6. **Plan:** semester board (columns, load meter per semester coloured by server numbers: cyan < 85%, amber to the limit, red over), **load strip** (one cell per semester incl. summers), readout strip, graduation "build status" block, weekly timetable grid with clash outline.
7. **Scenarios:** violet what-if banner, change chips, **diff block** (`+`/`-` lines from real comparison data only), account/auth/report restyle.

### File ownership (so parallel agents do not collide)
| Stream | Owns | Status |
| --- | --- | --- |
| D1 foundation, shell, command bar | `frontend/src/styles/**`, `app/**`, `components/**`, `main.tsx`, `index.html`, fonts in `package.json`, `docs/design/mission-control.md`, decision D-43 | **done** (8 Nov): look, shell, command bar, theme, Awards removed; own tests green |
| D2 requirements, record, performance, import | `features/requirements|record|performance|import/**` | running |
| D3 plan area | `features/plan/**` | running |
| D4 scenarios, account, auth, report | `features/scenarios|account|auth|report/**` | running |
Each stream: no git, no Python edits, own CSS files imported by its components (D1 alone edits `global.css`), tests updated, own e2e port pair (D1 8101/4301, D2 8102/4302, D3 8103/4303, D4 8104/4304), headless Playwright screenshots viewed with the image Read tool; D1 alone uses the Browser pane (stack on 8110/5310). Concept-page scratch files lived in the session scratchpad and are copied into `docs/design/`.

### Verification checklist (do all of these after the streams report)
1. `git status`: only expected files changed; no private files.
2. `.venv/Scripts/python scripts/test.py` all green (frontend count will change; the statement map must still resolve: `python -m unittest tests.domain.test_statement_map`).
3. Look at the screens yourself in dark AND light at desktop and 390 px (Playwright screenshots or the Browser pane): Requirements (signed out and in), My record, Performance, Import, Plan (Generate, edit, summer break, internship, lighten, reset), Scenarios (list, one scenario, compare with the diff block), Account, Sign in. Check: dark by default with OS light, no horizontal page scroll at 390 px, focus rings, contrast, nothing says "Awards", no prerequisite map, no invented numbers.
4. Command bar works from every page (Ctrl+K, `/`, Esc, arrows, Enter) and `/plan?generate=1` generates once.
5. `grep -rn "D-[0-9][0-9]"` and upper-snake codes in rendered text: none (tests exist; spot check).
6. Quick preflight, package, deploy, wait for health 200, `scripts/smoke_live.py`, then open the live site once in dark and light.

### Log (newest last)
- 8 Nov: concept approved ("implement it, dark default, this palette only, no prerequisite map, no awards"). `tokens.css` rewritten with the final palette (old names aliased). Four streams launched (D1-D4). Concept and smoke script copied into the repo (`docs/design/mission-control-concept.html`, `scripts/smoke_live.py`).
- 8 Nov: **D1 reported done.** Dark default (`theme.ts`, inline script in `index.html`), self-hosted fonts, restyled base + utility classes (documented at the top of `global.css`), shell with wordmark/nav/theme toggle, `CommandBar.tsx` (Ctrl/Cmd+K and `/`; command 'Generate a plan' goes to `/plan?generate=1`, D3 must handle it), Awards route/tab removed (`/awards` = page not found), `docs/design/mission-control.md`, D-43. Vitest for `src/app src/components src/lib`: 136 pass; build and `tsc -b` clean; Playwright public/responsive/phone-keyboard/student-flow pass. **Open notes from D1:** (a) in the LIGHT theme the plain `--accent/--ok/--warn` fail AA as text on `--bg`/`--bg2` (4.05/4.10/4.44); D1 added derived text tones `--accent-strong`, `--ok-text`, `--warn-text`, `--bad-text`, `--whatif-text` (token mixed 30% toward fg) and uses them for coloured text; Harsh should confirm that is acceptable (fills and borders keep the plain tones); (b) `ReportPage.tsx` still prints 'Awards considered: …' (D4 owns it; must go); (c) print output not checked.
- 8 Nov: stray throwaway screenshot specs `e2e/tests/zz-d3-screens.spec.ts` and `zz-d4-screens.spec.ts` exist from the streams: they must be DELETED before any commit.
- 8 Nov: **PR 1 is up:** https://github.com/HarshDhru23/cs437-MADHAM-hack/pull/39 (branch `feature/harsh-h14-azure-hosting`, one commit `2cdd021`, hosting only: settings, health + app-shell route, gunicorn/whitenoise, packaging script, runbook, `test_hosting.py`; verified in a clean worktree: python 324, django 54). A git worktree for it exists at `C:/Users/harsh/cs437-hosting-pr` (remove with `git worktree remove`).
- **PR 2 plan (not done yet; waits for D2-D4 because they were still editing frontend files):** (1) delete stray `e2e/tests/zz-*.spec.ts`; (2) `git reset feature/harsh-h14-azure-hosting` (mixed) on branch `feature/harsh-h15-plan-generator-fixes` so the branch sits on top of PR 1 without touching the working tree; (3) commits by layer: engine+data+schemas+examples+docs+python tests, then `server/**` + `scripts/smoke_live.py`, then frontend source/tests/e2e + `docs/design` + `context.md`; stage explicit paths only; end every commit message with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line; (4) full preflight + `scripts/test.py` green; (5) push and open the PR with base `feature/harsh-h14-azure-hosting` (stacked; retarget to `main` after PR 1 merges), description per `.claude/skills/coursepath/SKILL.md` section 4 ending with the 'Generated with Claude Code' line. Reviewer rotation Harsh to Aaryan; do not claim a review.
- 8 Nov: **D2, D3, D4 reported done** (D2: requirements ring `DegreeRing.tsx`, record tiles, performance CPI readout + `SpiSparkline.tsx`, import stepper; D3: plan board columns with load meters, `PlanLoadStrip.tsx`, readout strip, `?generate=1` auto-generate, weekly grid; D4: what-if banner/chips, `DiffBlock.tsx`/`diff.ts` (lines only from real comparison data), auth/account/report restyle, report print stays black on white, 'Awards considered' line removed). Each stream's vitest was green (555 in the last full run), `tsc -b` and `npm run build` clean, their e2e specs green on their own ports. Stray `zz-*` screenshot specs were deleted by the streams. One e2e (`responsive.spec.ts` keyboard order expects the first tab stop to read exactly 'CoursePath') broke because of the `>_` brand mark: fixed by drawing the mark in CSS (`.brand-mark::before`), spec untouched.
- 8 Nov: full integrated run started (`python scripts/test.py`); result to be added below. Not yet looked at by Harsh. Known soft spots from the streams: saved-plan page at phone width and light theme only lightly checked; arcs of the degree ring are hover/click-focus only (keyboard users get the same highlight from the group rows); mandatory courses show the requirement name twice in a plan chip (kept for test compatibility); print output not checked by eye.
- (add entries here: integrated test result, commits/PR 2 link, deploy and live check)

### If you take over mid-way
1. Read section 4 above, then `git status` and the newest files under `frontend/src/features/*/*.css`, `frontend/src/styles/global.css`, `docs/design/mission-control.md` (if D1 has written it).
2. Check which stream outputs exist; for a stream with no report, inspect its files and run its tests (`npx vitest run src/features/<area>`).
3. Finish the checklist in order; update the Log and the status table.
