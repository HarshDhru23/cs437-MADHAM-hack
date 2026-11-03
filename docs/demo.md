# Demo script and known limitations (M09)

For the 17 Nov demo; to be rehearsed at the 13 Nov readiness review. State on `main` at `5d3cdfd` (3 Nov 2026). Only synthetic data is ever shown: never a real student's record, name or roll number.

## Setup

1. Localhost: `python scripts/run.py` on a fresh database ([runbook](operations/runbook.md) §6). There is no hosted deployment; say so at the start.
2. A second browser or browser profile for the "other device", against the same local server.
3. The synthetic IMS sample on the import page, or the synthetic PDF from `e2e/fixtures/make_synthetic_pdf.py`.

## Order (from manashree.md M09)

| # | Step | Available on `main`? |
| --- | --- | --- |
| 1 | Public requirements before sign-in, with draft status and sources | yes |
| 2 | Sign up; import the synthetic PDF (or paste the IMS sample) | yes |
| 3 | Review: a flagged row and the source-total discrepancy (e.g. a short course outside degree credit) | yes |
| 4 | Audit: open a requirement, show counted courses and its source | yes |
| 5 | Current-term clash (PH 202 vs ES 667 lectures; PH 202 vs CS 331 tutorial) in the plan's timetable panel | yes (#29) |
| 6 | Full-degree tentative plan through semester 8, with "not checked" for terms without timetables | yes |
| 7 | CPI/SPI with counted and excluded attempts | yes |
| 8 | No / 3-month / 6-month internship comparison with exact dates from the 2026-27 calendar | yes (#28, #32) |
| 9 | Save on one browser, open the same account in the second browser on the same server; a stale edit gets a conflict | yes, on one local server only |
| 10 | The acceptance-run feature after 16 Nov | after 16 Nov |

Honours and the AI minor are not demonstrated: CP-25 to CP-27 were withdrawn on 3 Nov (D-18). Show the second import method only briefly. If a step fails, say so; do not mock it.

## Known limitations (3 Nov)

| Limitation | Affects |
| --- | --- |
| No hosted deployment; the app runs on localhost only. Saving across devices is shown only with two browsers or profiles signed in to the same account against one local server, not across real devices over a network. No hosted persistence is claimed. | CP-29 |
| Production serving and PostgreSQL in production are not verified (on hold with hosting); PostgreSQL runs only in the CI test job. | CP-32 |
| Lab/tutorial slots that list several options have unknown meaning (all required or one of them), so those clashes are "possible", not certain. | CP-24 (AMB-12) |
| Only 2026-27 has timetables and calendar dates. Later I/II terms show a same-parity hint only, and their clashes and internship overlaps are "not checked". | CP-23, CP-24, CP-33 (D-23, D-24, GAP-03) |
| Prerequisites are team recommendations shown as warnings, not institute rules. | CP-05, CP-22 (D-17) |
| Honours and AI minor are out of this release; the Awards page says so. | none (CP-25 to CP-27 withdrawn) |
| No observed user session yet. | CP-31 ([observations](qa/observations.md)) |
