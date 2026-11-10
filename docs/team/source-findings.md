# New workbook findings and required regression cases

Read-only review on 22 October 2026. Neither source workbook was edited or saved. These findings supplement the PDF/IMS evidence in the main roadmap.

## Supplied timetable

Source: `Timetable, Sem-I, 2026-27.xlsx`, sheets `Time table`, `Time Slots`, `Availability`.

- `Time table` has columns A:R: course number/name, L/T/P/C, instructors, capacity/enrolment, sections, lecture/tutorial/lab text, course-plan link, preferred knowledge, remarks, minor and HSS/BS tags. Course credits are **F**, not the L/T/P contact-hour columns.
- Inspection matched **330 course-pattern rows and 301 distinct literal course labels**; 13 labels occurred more than once. This is a source-inspection control, not a promise that every nonmatching row is invalid. Preserve headers, unusual codes and unmatched rows in the ingestion review report.
- Source used ranges include formatted empty rows up to row 1000. Iterate meaningful values; do not create 1000 fake offerings. `Availability` is a room/slot cross-check, not an independent set of offerings to add again.
- All preferred-knowledge and minor cells were empty in the matched course rows. Those headers do not supply prerequisites or a complete AI minor definition. A nonempty future preferred-knowledge field must still not automatically become a hard prerequisite.
- Snapshot revision/finality was not established by workbook filename alone. Preserve file hash, supplied term, sheet/cell and a separately recorded publication/review status.
- Course labels include section/language suffixes. Do not apply a global 'remove all parentheses' normalization; `(N)` course variants and `(E)/(H)` offering labels do not necessarily have the same meaning.

### Relevant source cells

| Course | Source | Credits / meetings |
| --- | --- | --- |
| CS 202 | `Time table!A27:N27`, repeated at row 110 | F=4; lecture K=`D1`; lab M=`J2,M2`. |
| CS 203 | row 28 | F=4; lecture `C2`; lab `K1,H1`. Separate from CS 202. |
| CS 330 | row 111 | F=4; lectures `E1,E2`; lab `H1`. Course-plan display text references CS 301, which is a clue to investigate, not an automatic approved alias. |
| CS 331 | row 112 | F=4; lectures `G1,G2`; tutorial `H2`. |
| CS 329 | row 64, repeated row 113 | F=4; lectures `P1,P2`. |
| ES 667 | row 250 | F=4; lectures `B1,B2`. |
| PH 202 | row 31 | F=4; lectures `B1,B2`; tutorial `H2`. |
| CS 437 | row 242 | F=2; labs `K1,L1`. Its absence from the example plan does not prove the student is not enrolled. |

`Time Slots!A1:F8` defines 30 teaching slots. Examples:

- B1: Tuesday 08:30-09:50; B2: Friday 08:30-09:50.
- H2: Wednesday 11:30-12:50; H1: Monday 17:00-18:20.
- D1: Tuesday 10:00-11:20; J2: Friday 14:00-15:20; M2: Friday 15:30-16:50.

Build the mapping from the sheet, not from these examples. Preserve all source cells. Different rooms do not remove a time conflict for the same student. Commas can represent multiple required meetings or unlabelled alternatives; the raw list must be resolved according to its section/group meaning before asserting every listed lab slot is compulsory. If the workbook does not distinguish alternatives, expose that uncertainty rather than manufacture section combinations.

## Example graduation plan

Source: the example graduation plan workbook (a private local file). The three sheets are `Graduation Plan`, `Course Basket Summary till 4th ` (trailing space) and `Sheet1`. Retain original sheet names in provenance even if display names are trimmed.

- `Graduation Plan!A2:E8` schedules seven four-credit courses in semester 5: HS 151, CS 330, CS 331, CS 202, CS 329, ES 667 and PH 202. **28 credits**.
- `A9:E14` schedules six four-credit rows in semester 6: ES 301, CS 421, CS 303, an online-credit HSS placeholder, a science-basket placeholder and a BS-elective placeholder. **24 credits**.
- `A16:C16` describes semester 7 as a **six-month internship with 12 open-elective + 4 HSS credits**, total **16**. It contains no exact dates, approved IN 498 module identifiers, quad assignment or approval evidence.
- `C18` is **68**. Details sum to 28+24+16=68. Summary `D14` is **66 remaining**, with 104 completed against 170 required; hence the plan schedules 2 extra credits. Excess is not inherently invalid.
- Summary row 9 counts 20 completed CSE core credits and the future plan still includes CS 202 after the transcript's CS 203. Keep the agreed CS 203/CS 202 ambiguity; this is a student's allocation, not institutional approval.
- Summary row 10 reports 12 completed discipline-elective credits. Do not use that value as an independent oracle for CS 203/project allocation without official rules. The row also hides the theory/systems subdivision needed by the actual audit.
- Summary `B11=38` combines first-year/institute obligations in a single presentation bucket. The domain should retain the finer official rule structure; do not create a conflicting 38-credit rule on top of separately counted FP/materials requirements.
- Summary PE/viva rows show zero remaining credits. **Zero credits do not establish completion of non-credit obligations**. Keep per-semester obligations in the domain and UI.
- There are no formulas in the example workbook. The totals are entered values; recalculate independently. `Sheet1` is a small label/reference area, not a completed plan.

## Required regression scenarios

1. PH 202 versus ES 667: both B1 and B2 lectures overlap for the same active date range. Emit lecture conflicts, preserving the two meeting occurrences and source cells.
2. PH 202 versus CS 331: H2 tutorial overlap where both meetings are required for selected sections. Do not hide tutorial conflicts because lectures are different.
3. Repeated CS 202 and CS 329 source rows must not double the student's credits/meetings when identical. Different sections or contradictory repeated rows must remain distinct/reviewable.
4. Current ES 112 offering reports 4 credits, while the historical transcript reports 3. Never overwrite earned-attempt credits with the current offering's credits.
5. Semester 6 `CS 421` is not silently converted to advisory `CS 431`. Treat course identity/equivalence as unresolved until supported.
6. `XX XXX` rows are requirement placeholders: display their basket/credit target, but they cannot satisfy actual prerequisites or verify an offering/clash-free plan until resolved to a course.
7. Compare 68 future planned credits with 66 remaining: display surplus 2, then validate category allocation. Neither '68 >= 66' nor '104 + 68 >= 170' proves graduation requirements are satisfied.
8. Import the example internship only as proposed 16 credits. `duration=6 months` alone yields **zero approved credits**. Validate 12 OE+4 HSS only after approved modules and caps are known.
9. No internship has no internship unavailability and no internship-derived credits. A three-month summer scenario blocks actual overlapping summer commitments without automatically blocking the following semester. A six-month scenario spanning semester 7 reveals its teaching/exam conflicts and downstream plan effects.
10. Later semesters have no inherited 'confirmed' slots merely because a code appears in the current timetable. Missing timetable yields `not_checked`, never `clear`.

The interface must distinguish source fact, student plan, approved rule and hypothetical scenario. Do not display a student's worksheet as an officially validated graduation plan.
