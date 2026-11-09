# Aaryan implementation tasks

Read [team instructions](README.md), [contracts](contracts.md), [source findings](source-findings.md) and the UI section of the product roadmap. Own `frontend/`, frontend unit/component tests, `e2e/` and `docs/ui/`. Harsh owns academic/API decisions; do not reproduce graduation, CPI, award, internship-credit or prerequisite calculations in React.

Task numbering is the implementation order inside the shared checkpoint blocks, not a daily schedule. Start independent owned tasks immediately; use readiness handoffs in the team README. The first-release deadline is27 October, full-feature freeze3 November, internal reviews8 and13 November, then official acceptance/demo16-17 November.

## A01. UI brief, shell and component foundation — first-release block (27 Oct)

Files: Vite React/TypeScript setup, dependency lockfile, `src/app/`, `src/styles/`, `src/components/`, `docs/ui/design.md` and screen/state checklist.

1. Inspect shared examples; sketch the actual first-run/import/requirements/planner structure at desktop and mobile sizes. Record the design tokens and task hierarchy before composing all screens. Apply relevant frontend/design skills when implementing; this document does not authorize discarding the agreed requirements-first flow.
2. Use a restrained academic-tool style: warm neutral page background, readable dark text, one deep blue/teal action accent, semantic status colors paired with labels/icons, one consistent sans-serif and tabular numbers for credits. Main body about16px; controls/touch targets about44px; visible focus and sufficient contrast. Do not use ornamental charts/animations to hide unresolved data.
3. Shell navigation: Requirements, My record, Plan; secondary routes/tabs for Performance, Awards, Scenarios and Account. Public requirements are accessible before login/import. Current cohort/rule version and whether data is actual/current/scenario are always discoverable.
4. Shared components: Button, input/select/textarea, tabs, status badge, source link/panel, issue list, course picker, credit progress, semantic data table, empty/loading/error panel, unsaved/save status, confirmation dialog and responsive drawer. Use stable shared styles rather than re-styling each feature independently.
5. Define routes: `/`, `/record/import`, `/record/review/:preview_id`, `/record`, `/performance`, `/awards`, `/plan/:plan_id`, `/scenarios`, `/account`, `/login`, `/signup`, `/report/:plan_id`. Deep links must survive reload through production SPA routing.

Checks: shell usable at390px and1440px; focus order follows reading order; no inaccessible drag-only actions; meaningful error/empty states; no real student identifiers in screenshots. Hand off frontend start/build/test commands and dev proxy port to Manashree.

## A02. Typed API client and state boundaries — first-release block (27 Oct)

Files: `src/api/client.ts`, `types.ts`, auth/session provider, resource hooks and synthetic mock fixtures.

1. Match contracts v1 exactly. One client handles JSON/envelope parsing, credentials/CSRF, loading/cancellation, standard errors and schema/version incompatibility. GET session first for CSRF/session bootstrap. Handle missing/expired auth without losing unsaved import draft.
2. Keep request types and synthetic response examples aligned with Harsh's schema. UI credits are formatted from decimal strings; authoritative arithmetic remains in the server. Never coerce missing counts/status into healthy zero/satisfied.
3. Use resource state keyed by user, record revision, plan revision and rule version. Invalidate analysis after confirmed record/plan/award changes. Discard stale in-flight analysis responses if their revisions no longer match.
4. Serialize/coalesce saves per resource. Debounce edits about500ms; preserve a dirty draft until acknowledgement. Distinguish saving/saved/offline/error/conflict. On409 show reload/compare and preserve the draft; do not retry with the new revision automatically.
5. Mock data supports UI work only. Isolate it behind a development flag with a visible development label; production build and acceptance runs use the real API. Missing endpoints must never silently fall back to simulated success.

Tests: envelope/error variants, abort/stale responses, auth expiry, pending save indicator, failed-save preservation,409 handling, source/unknown rendering. Ask Harsh for a contract correction before changing response fields yourself.

## A03. Import and review — first-release block (27 Oct)

Files: `src/features/import/`, component tests and import browser flow.

1. Equal tabs for Upload transcript PDF and Paste IMS grades. Show accepted size/layout and a concise privacy note. Add a synthetic sample-text action, file picker/drag drop with keyboard alternative and explicit parse button. Do not request IMS password or add generic spreadsheet import.
2. Preserve pending file/text across normal UI steps/auth transition without leaking it into URLs/logs/analytics. If secure file preservation across login cannot be guaranteed, login before upload while still allowing public requirement exploration. Explain a required reselect honestly rather than showing a lost file as uploaded.
3. Review is a separate route with `Import -> Review -> Analyze` progress. Show term groups, row count, source-reported versus extracted totals and unmatched/conflicting candidates. Filter issues/all rows, but retain context and a path back to every omitted/rejected row.
4. Table columns: term, code/title, credits, grade/status, match/review state. Inline editing preserves raw evidence and highlights changed fields. A source panel shows page/line/cell reference. Course equivalence warnings cannot be dismissed into official approval by changing a label.
5. Re-import diff groups new/unchanged/conflicting rows. Conflicts require a decision; existing user correction is visible. `Confirm record` submits candidate IDs/resolutions and expected revision. Disable only for actual blocking fields; unmatched but structurally valid rows can remain reviewable.
6. Successful commit navigates to real analysis with the new record revision. Malformed/oversized/encrypted/image-only inputs offer paste/manual correction and retain prior accepted record. Expired/foreign previews show a safe restart path.

Browser cases: supplied-layout synthetic PDF→39 rows→commit; IMS→40 rows→extra short-course review; correction and source evidence; re-import no duplicates; changed grade conflict; API parse failure; login expiry; failed commit/409. CP-06..14 UI coverage. No parser math in browser.

## A04. Accounts, accepted record and current enrolment — first-release block (27 Oct)

Files: `src/features/auth/`, `record/`, `account/`, integration tests.

Create signup/login/logout/password-change forms using actual Django routes; field validation complements server validation. Use proper autocomplete, password input/visibility, pending/error states and safe generic sign-in failures. Do not imply institutional SSO or verified academic identity.

Accepted record view separates completed history from current enrolment. Allow add/correct attempts and confirmed current courses/sections through revisioned server saves. Display latest completed term, source dates and unresolved classification/equivalence. Do not auto-populate current enrolment from the example workbook.

After sign-in on another browser/device, load server state and display its revision/update time. On sign-out remove personal cached state; a second user must never see the prior user's records. Offer account export/delete from account area; wire deletion in A11 after the API exists. Do not ship nonfunctional recovery/SSO buttons.

Tests: signup/login/logout, record reload, two browser contexts share acknowledged save, separate users isolated, expired session, stale save/409, dirty draft kept. CP-02,29; foundational isolation portion of32.

## A05. Requirements and explainable audit — first-release block (27 Oct)

Files: `src/features/requirements/`, audit/explanation components and tests.

Public mode shows all reviewed requirements grouped by basket before any history. Personal mode shows actual completed, completed+current and projected views as explicit controls. Do not change status labels merely by changing the amount of a progress bar.

Use a compact overview with degree-allocated completed credits, reported source credits, remaining requirements and unresolved decisions. Avoid adding parent/sub-basket displayed totals to produce a new frontend degree total. Requirement rows show status, required/count/remaining amount; expansion lists counted attempts, exclusions, approved sharing, sources and concrete remaining options.

Show CSE core separately from elective sub-baskets; GE inside HSS; science-basket versus further BS-elective allocation; zero-credit PE/viva obligations with semester states. Unknown source/approval and unresolved CS202 remain visible. Make `Why?` open the source/counting explanation, not a generic tooltip.

Mobile: stacked requirement rows with expandable details; desktop: table plus optional explanation side panel. Do not make every basket a separate full-screen page or hide a blocking issue below a long course list.

Tests: CP-01/03; no-history browse; failed/in-progress/planned not represented as earned; source detail; missing mandatory despite total credits; unknown prevents unconditional completion; placeholders stay unresolved; parent rollup not double-counted. Render independent expected fixtures and then real endpoint results.

## A06. Full-degree semester planner — first-release block (27 Oct)

Files: `src/features/plan/`, picker/edit controls and tests.

1. Display all remaining terms, initially to semester8, with extend-plan action. Current term is visually distinct; later terms carry availability/timetable evidence labels. Do not hardcode a universal maximum duration or copy current slots forward.
2. Semester table columns: course/placeholder, credits, requirement intent, prerequisite status, offering/section evidence and issues. Show selected-course credits and placeholder target credits separately. Add, remove and move use explicit buttons/selects; optional drag/drop must have an equivalent keyboard path. Include undo for local edits and acknowledged save status.
3. Search by code/title/basket/department. Course picker shows what the course could satisfy, prerequisites and offering evidence from server. No course recommendation should assert eligibility when evidence is unknown.
4. Students may add a labeled elective requirement placeholder. It counts as unresolved target workload and cannot appear as a verified offered/eligible course. Provide `Choose a course` to resolve it.
5. Validation panel groups errors/warnings/unknown/approval-required. Clicking an issue highlights affected items and exposes source/reason/action. Show downstream courses when a prerequisite is moved. No automatic course rescheduling.
6. Load warnings distinguish20-24 guidance, hard caps and approval-dependent overload. UI cannot approve an exception or change official rules. Changing an award/assumption re-runs server evaluation.

Tests: CP-04/05,20..24; add/remove/move/reload; nested unmet prerequisite explained; duplicate; source/current credit variant; missing future timetable; unresolved placeholder; selected section alternative; saved/unsaved/offline states; keyboard course move. First usable real-API flow due27 Oct.

## A07. CPI/SPI details — first-release block (27 Oct)

Files: `src/features/performance/`, contributing-attempt view and tests.

Display cumulative CPI, per-term SPI table, source-reported versus recalculated value, performance credits/points and policy-completeness state. Expand a term/value to inspect included/excluded attempts and source. P is performance-excluded even when credit-bearing. Missing/zero denominator is `Unavailable` with reason, not0. Show hypothetical scenario grades/values under an unmistakable scenario label.

Use server values; no client weighted-grade formula. Tests show the sample record's CPI, points and credits fixture correctly, no raw105-as-CPI-denominator, unavailable exceptional policy, per-term breakdown and rounded display. CP-15/16. A trend chart is optional only after the readable table and tests work.

## A08. Course offerings, section choice and clashes — full-feature block (3 Nov)

Files: offering/section components in planner and weekly meeting detail.

Show term snapshot label/date/review/coverage. Distinguish confirmed in supplied snapshot, tentative, historical hint and unknown. Current snapshot is not a registration guarantee. A course's absence from partial coverage remains unknown.

Section picker displays required lecture/tutorial/lab meetings and actual alternatives. Unknown grouping gets a visible clarification message; do not flatten all lab slot strings into compulsory student attendance. Display readable weekday/time/date range/room with source cells. A weekly detail view supplements the semester table; it is not the only way to read conflicts.

Explain actual overlaps: PH202/ES667 B1/B2 lectures; PH202/CS331 H2 tutorial. Different rooms do not resolve them. Show `Not checked` for absent timetable, not a green checkmark. Tests include alternative sections, unknown grouping, no overlap across different active quads and future terms with no snapshot. CP-23/24.

## A09. Honours, AI minor, scenarios and internship comparison — full-feature block (3 Nov)

Files: `src/features/awards/`, `scenarios/`, internship editor/comparison components and tests.

Awards: choose base/CSE honours/AI minor goals; show eligibility-to-pursue, earned and projected progress separately. Expand approved course/project/overlap details. Joint sharing appears as an inspectable allocation with source; do not combine three independent frontend totals. Future minor extension can use the same generic award components; release selection exposes only supported award definitions.

Scenarios: create a named clone of current saved baseline; prominent scenario banner, baseline revision/date and return-to-baseline action. Support drop/fail/postpone/replace/cap changes using typed controls. Exact hypothetical changes are visible. Scenario save never edits the accepted record.

Internship control has three equal understandable options: `No internship`, `3 months`, `6 months`. Choosing a duration opens `Summer`, `Semester`, `Custom dates`; presets use server-supplied calendar dates. Use labeled start and inclusive end date, actual duration and overlapping-term summary. If calendar dates are missing, ask for exact dates; do not guess. Explain a changed duration when dates are adjusted.

Separate panels: `Time away / course conflicts` and `Proposed academic credit`. Show placement/availability assumptions, approval state,4-credit modules with quad and proposed target basket, policy caps and unresolved evidence. Initial duration selection awards no credits. Example12OE+4HSS can be a proposed template with an explicit pending-approval label; never a completed-credit preset.

Comparison table: rows for terms away, affected courses, selected/placeholder workload, actual/proposed/approved credits, base/award deficits, prerequisite/clash issues and evidence-dependent completion term; columns baseline/no internship/3months/6months. Use the same baseline revision and actual data for every case. Differences can be unavailable; do not convert them to zero.

Changing a scenario recomputes server results; show stale/re-evaluating state. `Apply to plan` confirms only future plan edits and checks revisions. It cannot apply hypothetical failed grades to actual history. Scenario removal returns safely to the baseline.

Tests: CP-25..28,33/34; source-incomplete award, base-core exclusion, sharing explanation, none/3/6 date edits, summer versus term overlap, zero automatic credit, approval-required module, cap rejection, stale baseline/rebase, immutable actual record and plan-only apply. Use real APIs for final acceptance.

## A10. Browser acceptance and responsive/accessibility verification — first-release flows27 Oct; complete suite3 Nov

Files: `e2e/`, supported Playwright config/fixtures and non-personal artifacts; component tests where state transitions merit them.

Follow the applicable frontend-testing skill during implementation. Browser tests start the actual app and call real APIs/domain/storage. Mocks may isolate component states but cannot establish CP completion. Provide commands/config for Manashree's root test orchestration.

Required end-to-end flows:

1. Public full requirements before login/history.
2. New account -> IMS paste -> review/correct -> confirm -> actual audit -> add/move course -> save -> reload in second context.
3. Supported PDF -> all semester rows -> source totals -> re-import/conflict resolution.
4. Current-term course/section selection -> real supplied-snapshot clash; future term -> not checked.
5. CPI/SPI details -> honours/AI minor -> allocation/source explanation.
6. Baseline clone -> compare none/3/6 internship dates/modules -> explain changed requirement/course -> leave actual record unchanged -> explicit plan-only apply.
7. Offline/failed save,409,expired session and safe retry/reload without lost draft.
8. Account isolation, own export/deletion and no leaked prior-user cache.

Check390px/tablet/1440px, keyboard-only primary flow,200% zoom, meaningful labels/focus, reduced motion and contrast. Prefer role/label-based locators; avoid long sleeps/fragile CSS selectors. Fix all observed defects in a batch and confirm once; do not spend the deadline on repeated cosmetic loops. CP-31 needs an actual user flow as well as automation.

## A11. Report, backup, account deletion and user-feedback fixes — full-feature block (3 Nov)

Print view includes selected cohort/rule/source versions, actual/current/projected distinction, allocations/remaining work, scenario assumptions and unresolved issues. Use semantic HTML/print CSS; never label it an official institute approval. Backups download through authenticated API; restoration is a preview/confirm flow, not an automatic overwrite.

Account deletion explains exactly which data/account/session state is removed and documented backup retention. Use explicit confirmation; display server failure and do not pretend data was deleted. Sign-out clears personal frontend cache. Export safe text values; do not inject raw imported HTML/URLs into the DOM.

Observe Aayush and another student performing the tasks in M09. Record actual points of confusion, fix them and re-run relevant tests. Do not invent feedback or change factual academic wording to sound simpler if meaning changes.

## A12. Freeze, review and demo — freeze3 Nov; readiness reviews8 and13 Nov; official events16-17 Nov

By3 Nov eliminate mock fallback from release paths, ensure production build/deep links work, verify cross-device persisted state, clean console/browser errors and complete the CP evidence map. On3 Nov demonstrate the frozen build. During review window fix reported regressions without hiding SPEC changes. Rehearse the actual demo with synthetic data, readable zoom and a deterministic baseline; the16 Nov unseen feature gets its own new statement/test before implementation.

Each handoff records task/CP IDs, screenshots of synthetic data if useful, actual API dependencies, commands/results, responsive/user observations and remaining blockers. Do not claim UI completion from screenshots alone.
