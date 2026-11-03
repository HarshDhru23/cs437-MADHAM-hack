# Ambiguity register (M01.5)

Every entry is unresolved. Where a committed document states the rule or the conflict, it is cited; nothing here is a decision. "Owner" is who must supply the evidence or decide.

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
| AMB-10 | Evidence for any term after 2026-27-I: offerings, slots, dates. **Resolved 3 Nov:** 2026-27-II is now official (D-22); later I/II terms use the same-parity 2026-27 list as a hint only (D-23); calendar dates after 2026-27 stay unknown (D-24). | team README; contracts §5 | CP-23, CP-24 | Manashree (collect) |
| AMB-11 | Is the supplied timetable workbook final, and what is its revision date? **Resolved 3 Nov (D-22):** the Semester I and II files are the official timetables; Harsh confirmed no further review is needed. Neither file states a revision date. | findings; roadmap §11 | CP-23, CP-24 | Manashree |
| AMB-12 | Do comma-separated lab/tutorial slots (e.g. CS 202 lab `J2,M2`) mean all required or alternatives? Adapter marks `selection_semantics=unknown`. | findings | CP-24 | timetable owner |
| AMB-13 | Active date range / quad of each timetable course (first or second half). Adapter leaves `active_start_date`/`active_end_date` null. **Resolved 3 Nov (D-22, D-24):** "(first half)" courses run Q1-Q2, "(second half)" Q3-Q4, others from the first to the last day of classes; the snapshots carry these dates. | roadmap §5 | CP-24, CP-33 | Manashree + calendar |
| AMB-14 | `SourceReference.kind` has no value for calendars/catalogues; and `OfferingSnapshot` has no field for publication status. Adapter uses `advisory` and an extra `publication_status`. | contracts §2, §5 | schema (H01) | Harsh |
| AMB-15 | Does the display text `CS301:OS` on the CS 330 course-plan link indicate an equivalence? Treated as a clue only. | findings | CP-13 | Harsh |
| AMB-16 | Real layout of the `Time Slots` and `Availability` sheets and header text of `Time table`. **Checked on the supplied workbook (27 Oct, Harsh's review):** `Time Slots` uses `Slot, M, T, W, Th, F` (T = Tuesday, Th = Thursday); meeting cells put the slot list on one line and a shared room list in parentheses on the next, or one slot with its own rooms per line; `Availability` is a slot-by-room grid with course codes in the cells. The adapter now reads these formats; `tests/data_sources/test_timetable_real.py` checks them when the git-ignored workbook is present. Still open: whether several lab/tutorial slots are alternatives or all required (54 groups reported `MEETING_SEMANTICS_UNKNOWN`), and four sessions given as explicit day/time text instead of slots. | manashree.md M02 steps 1-4, 9 | M02 | Manashree (semantics with the timetable owner) |
| AMB-17 | Sub-section meaning of the example plan's summary rows (20 core, 12 discipline-elective, 38 institute credits): not official truth. | findings | CP-03, CP-17 | Harsh |
