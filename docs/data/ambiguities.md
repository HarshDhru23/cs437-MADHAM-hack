# Ambiguity register (M01.5)

Questions found in the sources, with the evidence cited. The table below the register gives each entry's current status. A "decided" entry is resolved by a numbered decision in [docs/academic-decisions.md](../academic-decisions.md); a decision marked TEAM is the team's interpretation, not an institute confirmation. "Owner" is who must supply the evidence or decide.

| ID | Question | Evidence in committed docs | Affects | Owner |
| --- | --- | --- | --- | --- |
| AMB-01 | Is CS 203 (transcript) an approved substitute for core CS 202? | roadmap §3.2; findings: example plans CS 202 after CS 203 | CP-13, CP-03, CP-17 | Harsh + official equivalence list |
| AMB-02 | Is CS 421 (example plan sem 6) the advisory's CS 431? | findings regression 5 | CP-13, CP-22 | Harsh + catalogue |
| AMB-03 | How do the two CS 299 registrations count, and against which project caps (open project 4, project 16, online+project 8)? | roadmap §3.1/3.2 | CP-10, CP-18 | Harsh + project policy |
| AMB-04 | Is ES 242(N) the core course ES 242, and which credits apply? | roadmap §3.2 | CP-10, CP-13 | Harsh + catalogue |
| AMB-05 | Classification of SC 372 (1 credit, only in the IMS paste); advisory p. 7 excludes one-credit short courses from graduation. | roadmap §3.2, §4.4 | CP-12, CP-14 | Harsh + advisory |
| AMB-06 | CPI/SPI treatment of failed, repeated, substituted, withdrawn and incomplete attempts; rounding and cap. | roadmap §5 | CP-15, CP-16 | Harsh + evaluation policy |
| AMB-07 | Which courses are on the CSE honours and AI minor lists; joint sharing limits; base-core reuse. | roadmap §3.2, §5 | CP-25..27 | Harsh + AI minor document (missing) |
| AMB-08 | Approval, quad mapping and load treatment of IN 498 modules; does an advisory cap alone fix credited modules? | contracts §6; M04 step 7 | CP-33, CP-34 | Harsh + external-exposure advisory |
| AMB-09 | Meaning of "Pass or Fail grade is mandatory" for the comprehensive viva; does zero remaining credits mean complete? | roadmap §3.1; findings | CP-14, CP-20 | Harsh + advisory clarification |
| AMB-10 | Evidence for any term after 2026-27-I: offerings, slots, dates. | team README; contracts §5 | CP-23, CP-24 | Manashree (collect) |
| AMB-11 | Is the supplied timetable workbook final, and what is its revision date? | findings; roadmap §11 | CP-23, CP-24 | Manashree |
| AMB-12 | Do comma-separated lab/tutorial slots (e.g. CS 202 lab `J2,M2`) mean all required or alternatives? Adapter marks `selection_semantics=unknown`. | findings | CP-24 | timetable owner |
| AMB-13 | Active date range / quad of each timetable course (first or second half). Adapter leaves `active_start_date`/`active_end_date` null. | roadmap §5 | CP-24, CP-33 | Manashree + calendar |
| AMB-14 | `SourceReference.kind` has no value for calendars/catalogues; and `OfferingSnapshot` has no field for publication status. Adapter uses `advisory` and an extra `publication_status`. | contracts §2, §5 | schema (H01) | Harsh |
| AMB-15 | Does the display text `CS301:OS` on the CS 330 course-plan link indicate an equivalence? Treated as a clue only. | findings | CP-13 | Harsh |
| AMB-16 | Real layout of the `Time Slots` and `Availability` sheets and header text of `Time table`. **Checked on the supplied workbook (27 Oct, Harsh's review):** `Time Slots` uses `Slot, M, T, W, Th, F` (T = Tuesday, Th = Thursday); meeting cells put the slot list on one line and a shared room list in parentheses on the next, or one slot with its own rooms per line; `Availability` is a slot-by-room grid with course codes in the cells. The adapter now reads these formats; `tests/data_sources/test_timetable_real.py` checks them when the git-ignored workbook is present. Still open: whether several lab/tutorial slots are alternatives or all required (54 groups reported `MEETING_SEMANTICS_UNKNOWN`), and four sessions given as explicit day/time text instead of slots. | manashree.md M02 steps 1-4, 9 | M02 | Manashree (semantics with the timetable owner) |
| AMB-17 | Sub-section meaning of the example plan's summary rows (20 core, 12 discipline-elective, 38 institute credits): not official truth. | findings | CP-03, CP-17 | Harsh |

## Status (3 Nov 2026)

Updated per the "Implementation follow-ups" table in docs/academic-decisions.md (29-31 Oct).

| ID | Status | By |
| --- | --- | --- |
| AMB-01 | decided: CS 203 is not CS 202; CS 203 is a discipline elective and the CS 202 core stays pending | D-03 |
| AMB-02 | decided: CS 421 is its own CS-coded discipline elective; CS 431 stays a separate systems-basket course (different code and course) | D-01, D-06 |
| AMB-03 | decided: each CS 299 is a separate attempt; first is the open project, second a discipline elective; at most 16 project credits | D-01, D-09, D-10 |
| AMB-04 | decided: ES 242(N) is DSA I by identity group; credits actually taken are earned | D-02, D-04 |
| AMB-05 | decided: SC 372 is a one-credit short course, kept on the record, never counted toward 170 | D-08 |
| AMB-06 | partly decided: repeats count the best grade (TEAM); withdrawal/incomplete policy, rounding (round or truncate) and SPI of a later-repeated term remain open | D-15; decisions "Still open" |
| AMB-07 | **deferred**: no AI minor document or CSE honours list; CP-25..27 stay red | D-18 |
| AMB-08 | decided for modelling: 4-credit modules, 16 overall, OE/HSS (8)/open project (4); per-quad limit not modelled; load treatment still unknown (engine reports `INTERNSHIP_LOAD_POLICY_UNKNOWN`) | D-14 |
| AMB-09 | decided (TEAM, stricter than ADV13 p. 4): a P in every active semester; whether IN 101-104 are the viva records is still open | D-16 |
| AMB-10 | open: no evidence for any term after 2026-27-I | - |
| AMB-11 | open: workbook finality and revision date not established | - |
| AMB-12 | open: 54 lab/tutorial groups with unknown alternative/required meaning; the clash engine reports them as possible, never certain | - |
| AMB-13 | open: active date ranges unknown; clashes between undated meetings are reported as possible | - |
| AMB-14 | open: schema fields for calendar/catalogue `kind` and `publication_status` | Harsh |
| AMB-15 | decided: CS 301 is in the CS 330 Operating Systems identity group (by name) | D-04 |
| AMB-16 | layout verified on the supplied workbook (27 Oct); semantics part is AMB-12 | - |
| AMB-17 | open, by design: the example plan's summary rows are not official truth | - |
