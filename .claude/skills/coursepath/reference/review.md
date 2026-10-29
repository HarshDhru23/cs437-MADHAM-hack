# Reviewing a teammate's PR

Rotation: Harsh's PRs → Aaryan, Aaryan's → Manashree, Manashree's → Harsh. The judges read `git log` and PR history, so a review is graded evidence. "LGTM" on a large diff is not a review.

## How to review with Claude

1. `git fetch origin` then `git switch --detach origin/<their-branch>`.
2. Run `python .claude/skills/coursepath/scripts/preflight.py --owner <their-name>`. Every FAIL blocks approval.
3. Run `/code-review` on the branch for a correctness pass, then walk the checklist below yourself.
4. Do the user flow the PR claims, yourself, with synthetic data.
5. Leave specific comments (file:line, what breaks, the input that breaks it). Approve only as yourself, in GitHub.

## Checklist

**Scope and ownership**
- [ ] Files changed are inside the author's boundary, or each cross-boundary change was agreed in a handoff request.
- [ ] The PR maps to a task card and CP IDs; nothing out of scope was slipped in.

**Spec and test honesty** (judging criterion "Honest tests")
- [ ] Every new behavior has a SPEC statement and a test ID in `statement-test-map.json`.
- [ ] Expected values are justified from sources, not copied from output. Ask "where did 849 come from?"
- [ ] At least one negative case for the plausible wrong implementation.
- [ ] **Break it on purpose:** change one line of the implementation (e.g. include P in CPI, treat `<=` as overlap), run the test, confirm it fails, revert. If nothing fails, the test is not honest.
- [ ] No new `skip`/`xfail`, no weakened assertions, no expected-value edits without source evidence.

**Academic correctness**
- [ ] No invented rule, equivalence, prerequisite, basket membership, approval or internship credit.
- [ ] Unknown stays unknown (not `[]`, not 0, not "clear", not "satisfied").
- [ ] Known traps respected (CS 203≠CS 202, ES 242(N), two CS 299, SC 372, P/E handling).
- [ ] Frontend computes no academic number.

**Contract and integration**
- [ ] Any shape change updates schema + examples + consumers in this PR, or is additive.
- [ ] Decimal strings for credits; end-exclusive intervals; snake_case; issue codes not message text.
- [ ] Mutations send/check `expected_revision`; 409 handled without auto-retry.
- [ ] Migrations included for model changes; `makemigrations --check` clean.

**Security and privacy**
- [ ] Owner-scoped queries; foreign IDs give 404; no user ID trusted from request JSON.
- [ ] No secrets, private records, real roll numbers or real-data screenshots.
- [ ] No full transcripts/grades in logs or error messages.

**User experience** (frontend PRs)
- [ ] Empty, loading, error, unknown and conflict states exist and are distinguishable.
- [ ] Keyboard path for every action (no drag-only); visible focus; labels for screen readers.
- [ ] Works at 390px width with no horizontal page scroll; status colors also have text/icon.
- [ ] Real API in release paths; mocks only behind a visible dev flag.

**Deployability**
- [ ] No hardcoded `localhost` URLs, ports or absolute machine paths.
- [ ] New settings/env vars documented (name, purpose, dev default) and absent from committed secrets.
- [ ] New dependencies pinned in the lockfile.
