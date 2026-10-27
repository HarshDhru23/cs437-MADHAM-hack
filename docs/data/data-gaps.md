# Data gaps (M04)

Status as of 26 Oct 2026. Only the transcript, IMS paste and advisory files have been supplied locally (git-ignored); everything else is judged from committed documents. No message has been sent to anyone and no portal was used. "Needed" dates come from roadmap §11. A gap on a supported feature is a release blocker for that feature.

| ID | Missing evidence | Affected CP / tasks | Needed | Status | Decision owner |
| --- | --- | --- | --- | --- | --- |
| GAP-01 | Transcript and IMS paste were supplied on 26 Oct and a hand-transcribed row-level oracle exists (39 + 1 rows). It is real grade data, so it stays local and git-ignored as `real_transcript_oracle.json` beside the originals; CI uses the committed `synthetic_transcript_rows.json`, which has the same structure and public controls with invented courses and grades. **Still missing:** consented anonymized examples with failed/repeated/multipage/current-enrolment cases (see GAP-12). | CP-06, CP-07, CP-10, CP-11, CP-12; M01, M05 | 27 Oct | **closed for the sample; open for exceptional cases** | Manashree |
| GAP-02 | The supplied timetable workbook is available locally (git-ignored). On 27 Oct the adapter was run on it: 330/301/13 rows, 30 slots, 303 offerings, 0 errors, documented overlaps reproduced (`tests/data_sources/test_timetable_real.py`, opt-in). **Still open:** lab/tutorial alternative semantics (AMB-16), the graduation-plan workbook, and a reviewed snapshot handed to Harsh for H11. | CP-23, CP-24; M02 | 27 Oct (adapter), 3 Nov (reviewed snapshot) | adapter verified on the real file; snapshot review open | Manashree |
| GAP-03 | Official 2026-27 academic calendar dates (terms, quads, recess, exams, registration). The calendar page is not committed and was not fetched. `data/calendars/` is intentionally not created. | CP-24, CP-33; M04.1 | 27 Oct (first-release cases), 3 Nov | open | Manashree to collect, Harsh to review |
| GAP-04 | CSE equivalence/substitution list (CS 203 vs 202, ES 242(N), historical codes). | CP-03, CP-13, CP-17 | 27 Oct | open | Harsh |
| GAP-05 | Approved CSE basket lists and BS/HSS/GE/open-elective guidance. | CP-17, CP-18 | 27 Oct | open | Harsh |
| GAP-06 | Grading, repeat, incomplete/withdrawal and CPI/SPI policies. | CP-14, CP-15, CP-16 | 27 Oct | open | Harsh |
| GAP-07 | Complete AI minor advisory and CSE honours definition. | CP-25, CP-26, CP-27 | 3 Nov | open (retrieval failed per roadmap) | Harsh |
| GAP-08 | Harsh's import, performance, audit and plan-workload services and Aaryan's frontend/browser suite are merged and run against the M03/M05 oracles. Clash, internship and scenario services (H11-H14) are not built, so those oracle cases cannot run yet. | CP-24, CP-33, CP-34; M03, M05 | 3 Nov | partly closed | Harsh |
| GAP-09 | Course prerequisites/co-requisites/consent per course. Workbook "preferred knowledge" and minor columns are empty in matched rows and are never read as prerequisites. | CP-05, CP-22 | before feature accepted | open | Harsh |
| GAP-10 | Project/online-course counting policy; external-exposure advisory, module mapping, approvers and load treatment; viva semantics. | CP-10, CP-18, CP-33, CP-34 | before feature accepted | open | Harsh |
| GAP-11 | Final 2026-27 Semester I offering list/revision date; Semester II list when published. | CP-23 | 3 Nov | open | Manashree |
| GAP-12 | Further anonymized transcript examples (failed, repeated, multipage, current enrolment) with independently checked results. | CP-09, CP-11, CP-14 | before feature accepted | open | team |
| GAP-13 | Hosting, domain and persistence choice. | CP-29, CP-32; M08 | local 27 Oct; hosted 3 Nov | open | team |
