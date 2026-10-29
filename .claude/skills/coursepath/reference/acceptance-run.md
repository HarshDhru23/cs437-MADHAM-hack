# Acceptance run playbook (Monday 16 November)

Someone outside the team asks for a feature in plain English. The team writes it into SPEC.md, adds tests, builds it, and **your own test suite decides**. Judges check whether it was built in time and whether the tests really check it. Process (spec → test → reviewed PR) must be visible in `git log`.

Do not pre-build or guess the feature. Prepare the *process* and keep the codebase easy to extend.

## Before the day

- [ ] Main is green, deployed and tagged (e.g. `release-2026-11-13`) so you can always fall back.
- [ ] Everyone can run the full stack and full tests from a fresh pull in under 10 minutes.
- [ ] Extension points are healthy: rules are data in `data/`, rule expressions are typed and generic, issue codes are a registry, the award engine loads new definitions without code changes, the frontend has reusable table/issue/source components.
- [ ] Rehearse once (13 Nov) with an invented request and time each phase. Practice prompts (invented, not predictions):
  - "Let me mark a planned course as pass/fail and see how that changes CPI."
  - "Show me which remaining requirements each course in the timetable could satisfy."
  - "Warn me if a semester has more than two lab courses."
  - "Let me export my plan as a calendar file."

## On the day: the sequence

1. **Capture** the request verbatim at the top of a new SPEC section with the requester's name and time. *(5 min)*
2. **Clarify** with the requester immediately: inputs, outputs, edge cases, what "done" looks like to them. Write their answers down. *(10 min)*
3. **Split** into checkable statements, new IDs after the last CP (CP-35, CP-36…). Each statement one observable behavior. *(10 min)*
4. **Tests first, all red.** For each statement: a domain/API test with independently justified expected values plus a negative case; an e2e test if it has a UI. Commit and push the red tests in their own PR or first commit so the order is visible in history. *(30–45 min)*
5. **Slice by layer and assign**, using the normal boundaries unless the feature lives in one layer only:
   - Contract change first (Harsh): schema + example in a small `[contract]` PR, merged fast.
   - Backend logic/API (Harsh), UI (Aaryan) against the new example, independent oracle + regression + docs (Manashree) in parallel.
6. **Implement → preflight → review → merge** in small PRs. Reviews are fast but real (run the break-it-on-purpose check on the key test).
7. **Full regression** (`python scripts/test.py`) on main after the last merge. Nothing previously green may go red.
8. **Deploy and try it as the requester would** on the hosted URL. Ideally the requester tries it.
9. **Record evidence**: commit SHAs, PR links, test results, who did what, AI use in each person's lab notes.

## If time runs short

Ship a smaller statement that fully works and is honestly tested rather than a larger one that half works. Mark the descoped part explicitly in SPEC as not delivered. Never weaken a test to make the deadline.
