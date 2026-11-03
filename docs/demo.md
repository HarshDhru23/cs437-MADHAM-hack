# Demo script and known limitations (M09)

For the 17 Nov demo; to be rehearsed at the 13 Nov readiness review. State on `main` at `43c5d96` (3 Nov 2026). Only synthetic data is ever shown: never a real student's record, name or roll number.

## Setup

1. Hosted URL if deployed (none yet: see [runbook](operations/runbook.md) §2); otherwise the local fallback `python scripts/run.py` on a fresh database, and say it is local.
2. Two browser windows (second "device") and the synthetic IMS sample / synthetic PDF (`e2e/fixtures/make_synthetic_pdf.py`).

## Order (from manashree.md M09)

| # | Step | Available on `main`? |
| --- | --- | --- |
| 1 | Public requirements before sign-in, with draft status and sources | yes |
| 2 | Sign up; import the synthetic PDF (or paste the IMS sample) | yes |
| 3 | Review: a flagged row and the source-total discrepancy (e.g. a short course outside degree credit) | yes |
| 4 | Audit: open a requirement, show counted courses and its source | yes |
| 5 | Current-term clash (PH 202 vs ES 667 lectures; PH 202 vs CS 331 tutorial) | **backend only** (H11 merged; A08 UI branch not merged). Without it, show the API response or skip |
| 6 | Full-degree tentative plan through semester 8, with "not checked" for terms without timetables | yes |
| 7 | CPI/SPI with counted and excluded attempts | yes |
| 8 | Honours / AI minor | **no**: award definitions missing (GAP-07); page says not available |
| 9 | No / 3-month / 6-month internship comparison | **backend only** (H12/H13 merged; A09 UI branch not merged); Scenarios page is a placeholder |
| 10 | Cross-device save: second window sees the plan; a stale edit gets a conflict | yes (local); hosted not shown |
| 11 | The acceptance-run feature after 16 Nov | after 16 Nov |

Show the second import method only briefly. If a step is unavailable, say so; do not mock it.

## Known limitations (3 Nov)

- Not hosted; no production serving (runbook §2). Cross-device persistence is shown only against one local server.
- CSE honours and AI minor are not evaluated (GAP-07); CP-25..27 have no tests.
- The timetable snapshot depends on the git-ignored supplied workbook; 54 lab/tutorial groups have unknown alternative/required meaning (AMB-12, AMB-16), so some clashes are "possible", not certain. Active date ranges are unknown (AMB-13).
- No institute calendar is committed (GAP-03): internship overlap with terms is reported as not checked.
- Only Semester I 2026-27 has a timetable; later terms are tentative/unknown.
- Prerequisites are team recommendations shown as warnings, not institute rules (academic-decisions D-17).
- No observed user session yet (docs/qa/observations.md).
