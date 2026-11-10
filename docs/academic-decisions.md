# Academic decisions for CSE 2024

Recorded 29 October 2026. Decided by Harsh for the team, from the January 2026 advisory and the team's own knowledge of IITGN practice. Scope: B.Tech CSE, students admitted in AY 2024-25.

These decisions are the approved interpretation for building CoursePath. Where a decision below conflicts with `docs/implementation-roadmap.md` §3 or §5, this file wins (see [Superseded text](#superseded-text)). A decision marked **team decision** is the team's reading or practice, not a quoted institute rule. The app must label it that way to students, and it should be confirmed with a faculty advisor when one is available.

## Sources

| ID | Source | Used for |
| --- | --- | --- |
| ADV13 | Academic Affairs Advisory No. 13, *Norms for BTech Programme* (January 2026). Local, git-ignored copy `Adv13_Norms for BTech Programme_28 Jan 2026.pdf`, SHA-256 `80d59bd2fb5b0096a57acd8192ba11387514cd8c08119e177cfd445c87c0861e`. Authorized by Harsh on 31 Oct 2026 as the curriculum source; cite by page, never commit the file. | pp. 1-4 institute curriculum (A.16 institute core, A.15 materials, A.2 HSS, A.5-A.6 science and maths), project, exposure and viva; p. 6 honours/minors; p. 7 load, project cap, short courses; p. 10 Annexure I science and maths baskets; pp. 14-15 CSE core and electives; p. 23 CSE 2024 sample path |
| CSE-CAT | CSE course catalogue, <https://cse.iitgn.ac.in/academics/courses/>, retrieved 29 Oct 2026 | Current codes, titles and credits |
| TT-2026-I | Official timetable workbook, Semester I 2026-27, committed as `Timetable, Sem-I, 2026-27.xlsx` on 3 Nov 2026 (D-22). | Codes, titles, slots and the slot legend for this term |
| TT-2026-II | Official timetable, Semester II 2026-27: a CSV export of the `Time table` sheet, committed as `Timetable, Sem-II, 2026-27 - Time table.csv` on 3 Nov 2026 (D-22). | Codes, titles and slots for this term |
| CAL-2026-27 | IITGN Academic Calendar 2026-27, <https://iitgn.ac.in/academics/calendar/acadcal-2026-27>, retrieved 3 Nov 2026. The table text is committed as `data/calendars/acadcal-2026-27.txt` (D-24). | Term, quad, exam, recess and vacation dates |
| TEAM | Team decision, Harsh, 29 Oct 2026 (later decisions give their own date) | Where the advisory is silent or needs interpreting |

The correct department site is **cse.iitgn.ac.in**. Links to `cs.iitgn.ac.in` in older notes are wrong.

## 1. Course identity

**D-01. Same code or same name means the same course** (TEAM). Two course records are the same course when either:
- their codes match exactly, including any suffix (`CS 616` = `CS 616`, but `CS 691-IV` ≠ `CS 691-XII`); or
- their titles match after normalization: case-insensitive, `&` read as `and`, punctuation and repeated spaces removed.

Titles that only partly match (one contains the other, or they share most words) are **not** the same course. They raise `EQUIVALENCE_UNCONFIRMED` with severity `needs_review`.

Exceptions, because these titles are reused for different content and repeated registration is normal (ADV13 p. 7, "no limit on the total number of project courses"):
- Project courses (`XX 299`, `XX 399`, `XX 499` and the open project) are never merged by title. Every registration is a separate attempt, even with the same code.
- Special-topics courses (titles starting "Special Topics") match by full code only.

**D-02. A same-named course with different credits satisfies the requirement; the student earns the credits actually taken** (TEAM). Example: old ES 242 DSA I (3 credits) satisfies the DSA I core, and the student earns 3 credits. Any shortfall or surplus shows up only in the degree total (170) and the parent subtotals, never as a second copy of the requirement.

**D-03. CS 203 is not CS 202.** CSE-CAT and TT-2026-I list both in the same term with different titles: CS 202 "Software Tools and Techniques for CSE" and CS 203 "Software Tools & Techniques for AI". CS 203 does **not** satisfy the CS 202 core, which stays pending until CS 202 is passed. CS 203 is CS-coded, so its credits count as a **discipline elective** (D-06).

**D-04. Known identity groups.** These follow from D-01 and D-02, and the catalogue data should encode them as identity groups. The first code in each row is the current one (ADV13 p. 23, TT-2026-I).

| Current | Same course | By |
| --- | --- | --- |
| ES 242 Data Structures and Algorithms I (4) | ES 242(N) (4); old ES 242 (3) | name |
| ES 214 Discrete Mathematics | CS 322 | name |
| ES 204 Digital Systems | ES 203 (CSE-CAT) | name |
| ES 336 Computer Organization & Architecture | ES 215 | name |
| CS 330 Operating Systems (4) | CS 301 (5) | name |
| CS 331 Computer Networks | CS 433 | name |
| ES 335 Machine Learning | ES 654, ES 678 | name |
| ES 667 Deep Learning | ES 413 | name |
| ES 645 Optimization Methods for Machine Learning | CS 608 | name |
| CS 615 Advanced Networks | CS 615 "Advanced Computer Networks" (CSE-CAT title) | code |
| CS 616 Parallel and Distributed Systems | CS 616 "Distributed Systems and Cloud Computing" (CSE-CAT title) | code |
| CS 333 Ethics of AI | CS 621 | name |

These pairs only partly match, so each one is flagged `needs_review` and not merged:

| Pair |
| --- |
| ES 668 "5G and Beyond" / ES 417 "5G and Beyond: An Introduction" |
| ES 659 "Computer Graphics" / CS 429 "Introduction to Computer Graphics" |
| ES 661 "Probabilistic Machine Learning" / CS 691-XII "Special Topics in Computer Science: Probabilistic Machine Learning" |

## 2. Requirement buckets

**D-05. CSE core: 36 credits, nine courses** (ADV13 p. 14, codes from p. 23):

| Course | Code |
| --- | --- |
| Data Structures & Algorithms I | ES 242 |
| Discrete Mathematics | ES 214 |
| Digital Systems | ES 204 |
| Computer Organization & Architecture | ES 336 |
| Theory of Computing | CS 201 |
| Operating Systems | CS 330 |
| Software Tools and Techniques for CSE | CS 202 |
| Foundations of AI: Multiagent Systems | CS 329 |
| Computer Networks | CS 331 |

**D-06. Discipline electives: 26 credits, from any CS-coded course or the p. 15 table** (ADV13 p. 15, row "All CS Elective Courses" + TEAM). At least 8 credits must come from the Theory & Algorithms basket and at least 8 from the Systems basket. Basket credits count inside the 26, not on top of it.

These courses qualify:
- **Every CS-coded course, at any level.** This includes CS 101, CS 203, CS 421, CS 613, CS 437 and special topics (CS 391, CS 491, CS 691-x). It excludes the nine core courses (D-05), which can never count twice. CS project courses also qualify, within the D-09 and D-10 project rules.
- **Every course in the table below.**
- **Any course that D-04 makes the same course** as one of these.

| Group | Courses |
| --- | --- |
| General (non-CS) | ES 335, ES 404, ES 615, ES 627, ES 637, ES 645, ES 659, ES 661, ES 666, ES 667, ES 669, ES 670, ES 676 |
| Theory & Algorithms basket | ES 301, CS 614, CS 617, CS 328 |
| Systems basket | CS 327, CS 332, CS 431, CS 432, CS 434, CS 435, CS 615, CS 616, ES 668 |

A CS course outside the two baskets counts toward the 26 but not toward either 8-credit basket minimum.

**D-07. Open electives, and courses are never split** (ADV13 p. 2, item 9 + TEAM).
- **Open electives total 16 credits.** Any course not claimed by another requirement can count, in any discipline.
- **A whole course goes to exactly one bucket.** Its credits are never split between buckets: a 4-credit course cannot put 2 credits in discipline electives and 2 in open electives.
- **Surplus credits.** If placing a course pushes a bucket past its required credits, all of that course's credits stay in that bucket and the excess is **surplus**. Surplus is earned and shown, but fills no other requirement. Example: seven 4-credit discipline electives give 28 credits against 26, so 2 credits are surplus.
- **Whole extra courses.** A course a requirement doesn't need at all may be placed whole in another eligible bucket, such as an eighth discipline-elective course going to open electives.
- **Allocation goal.** Choose placements that satisfy the most requirements and leave the least surplus. Report every placement, and every surplus credit, in the audit ledger.
- **Incomplete records** (clarified 31 Oct, from task H07). When no allocation completes the degree, place the most required credits, and put each course in the narrowest requirement it fits, so a basket course is never spent on open electives while its basket is unmet. The order is: complete degree, credits placed, narrowest placement, least surplus.

**D-08. One-credit short courses earn no graduation credit** (ADV13 p. 7). SC 372 (1 credit, IMS paste only) is a one-credit short course. Keep it in the record, show it as excluded with the reason, and never count it toward 170.

## 3. Projects, online courses and pass/fail

**D-09. At most 16 project credits count toward graduation, including the 4-credit open project** (ADV13 p. 7; TEAM chose this over the looser p. 2, item 8 wording). Project credits beyond 16 stay on the record and are shown as excluded with reason code `PROJECT_CAP`.

**D-10. Project credits are allocated in this order** (ADV13 pp. 2, 15 + TEAM):
1. **Open project** (4 credits): the first passed project course taken after the first year, in any discipline.
2. **Discipline electives**: at most 8 credits, shared with online courses (ADV13 p. 15, "Online courses and CS project courses can contribute at most 8 credits as discipline electives").
3. **Open electives**: whatever is left.
4. Excluded once the D-09 cap is reached.

For the sample record, the first CS 299 is the open project and the second is a discipline elective.

**D-11. Online pool: at most 16 online credits count, minus pass/fail conversions** (TEAM). Every credit the student converts from a letter grade to pass/fail reduces the online pool by the same amount. Example: one 4-credit course converted to P/F leaves 12 online credits. A converted course is excluded from CPI (D-15). Online credits beyond the pool are shown as excluded with reason code `ONLINE_POOL_CAP`.

**D-12. Detecting a pass/fail conversion** (TEAM). Transcripts do not mark conversions, so a **P on a course that is normally letter-graded** is treated as a conversion and uses up online pool credits. These courses are always graded pass/fail and are **never** treated as conversions:

| Course | Evidence |
| --- | --- |
| FP 100 Foundation Programme | P on the sample transcript |
| GE courses | ADV13 p. 2, item 4 |
| PE courses (0 credit) | P on the sample |
| IN 101 to IN 104 and other 0-credit IN records | P on the sample |
| One-credit short courses | D-08 |
| Comprehensive viva | ADV13 p. 3, item 18 |

The student can correct a wrongly inferred conversion in the review step. A correction is a record correction, not an academic approval.

Transcripts don't mark online courses either, so the student marks a course as online in the review step. Unmarked courses don't count against the pool.

**D-13. Where online credits count** (TEAM). Online credits go to discipline electives up to the shared 8-credit limit (D-10, step 2), then to open electives, all within the D-11 pool. Like external exposure (D-14), the planner offers the student different valid splits based on what they still need. *Open:* whether online credits may also count toward HSS electives.

## 4. External exposure

**D-14. External exposure (IN 498) splits** (ADV13 p. 3, items 11-13 + TEAM):
- Credit comes in 4-credit modules, at most 16 credits in total.
- It counts toward open electives, HSS electives (at most 8) and the open project (at most 4) only.
- It is non-mandatory, needs prior institute approval, and normally happens in the seventh semester.
- **Team decision:** ignore the per-quad limit (4 credits per quad). Don't model quads for exposure.
- The planner proposes valid splits of the 16 credits, using only what the student still needs in each bucket. Example: if the open project is done, offer no open-project credit.
- Internship length never awards credit by itself (roadmap §5). A proposed split stays `proposed` until the student records approval.

## 5. Grades, CPI and viva

**D-15. Repeated courses: the best grade counts** (TEAM). When a course (by D-01 identity) has several graded attempts, only the highest-grade attempt enters CPI and earns credit. The others stay on the record, marked superseded. Project and special-topics registrations, and IN 498 modules (ADV13 p. 3 A.12), are separate courses (D-01 exceptions), not repeats.

Credit and CPI use the same counted attempt (2 Nov, from the #18 review): a pass beats a fail (E is a fail although it carries 2 points), then more grade points (P has none), then more credits (D-02), then the current D-04 code, then the later term. Example: CS 432 F then CS 432 P: the P earns the credit, the F is superseded, and nothing from CS 432 enters CPI (D-11). Old ES 242 (3 credits, A) and ES 242(N) (4 credits, A): the 4-credit attempt counts, whatever the record IDs.

Grade points stay as in `data/grading/reported-v1.json` (A+ = 11 through F = 0, E = 2, P excluded from CPI, CPI shown with a maximum of 10). An unrepeated E or F stays in CPI with its points.

**D-16. The comprehensive viva needs a P in every active semester** (TEAM; stricter than the literal ADV13 p. 4, item 18(d)). An F or a missing viva grade in any active semester leaves the requirement unsatisfied, and the student must clear it in the next active semester (p. 4, item 18(b)). *Open:* confirm that IN 101 to IN 104 on the transcript are the per-semester viva records.

**D-16 reconciliation, 10 Nov 2026 (PR #113, CR-104; review by Harsh against ADV13, 28 Jan 2026).** ADV13 p. 4, item 18(d) makes a recorded **Pass or Fail** grade for the comprehensive viva in every active semester mandatory for graduation; item 18(b) concerns a failure to receive a grade. D-16 is stricter than that text, so the two are separated:
- **Plan validity (D-45, CP-36) follows item 18(d).** A recorded P or F viva grade in an active semester satisfies the plan check; a missing grade does not, and the plan is then "Not valid" with a problem that names the viva and the semesters without a grade. A recorded F never makes a plan not valid by itself.
- **The audit keeps D-16.** The viva requirement stays `pending` for an F or a missing grade and the audit results do not change; only the plan's validity gate is relaxed.
- *Open for Harsh:* whether D-16 itself should be loosened to item 18(d); until then the audit and the plan check intentionally differ for a recorded F.

## 6. Prerequisites

**D-17. Prerequisites are team recommendations, not institute rules** (TEAM). Neither ADV13, CSE-CAT nor the institute catalogue publishes prerequisites. CoursePath uses a team-curated list:
- The draft is in `data/prerequisites/cse-2024-recommended.json`, marked `draft` until the team approves it.
- The UI calls them **"recommended preparation (CoursePath team)"**.
- An unmet recommendation is a **warning that never blocks** a plan. Don't use the `error` severity that `semester_plan.py` currently gives `PREREQUISITE_MISSING`.
- A course without an entry shows "no recommendation recorded". That is still `unknown`, never "no prerequisites".
- Every recommendation is checked against the ADV13 p. 23 sample path: two courses that p. 23 schedules in the same semester never require each other.

## 7. Withdrawn

**D-18. AI minor and CSE honours are withdrawn from this release** (TEAM, deferred 29 Oct, withdrawn 3 Nov). Neither CSE-CAT nor ADV13 has the AI minor document or the CSE honours course list; p. 6 gives only the 20-credit framework. Rather than invent award rules or ship red promises, CP-25, CP-26 and CP-27 were removed from `SPEC.md` at the 3 Nov freeze; their IDs are not reused. Requests that name an award still return `AWARD_POLICY_MISSING`.

## 8. Memberships ADV13 names but does not list

Recorded 31 Oct 2026 by Harsh. ADV13 names these buckets for the 2024 cohort without listing their courses (pp. 1-2, 10; Annexure III applies only to students admitted before 2022-23).

**D-19. HSS electives and the GE basket by course code** (TEAM). Any HS-coded course counts as an HSS elective, except the mandatory HS 191, HS 192, HS 151, HS 221 and HS 201. Any GE-coded course counts toward the General Education basket (two courses, 4 credits).

**D-20. Basic Science electives** (TEAM, from ADV13 pp. 2, 10). The p. 10 science basket list, plus any course coded BS, MA, PH, CH, CG or EH, except the mandatory MA 103, MA 104, MA 203 and BS 192.

**D-21. Imported, current and planned courses are degree learning by default** (TEAM; scope confirmed 2 Nov after the #18 review). Rows from a transcript or IMS paste, confirmed current enrolment, planned courses and hypothetical scenario attempts made from them count as degree learning unless the student marks one as additional (honours or minor) in review. Without this default the current and projected views could not show completion until the student tagged every row.

## 9. Timetables, calendar and internship timing

Recorded 3 Nov 2026 by Harsh, when the official timetables and the calendar link were supplied.

**D-22. The 2026-27 timetables are official and complete** (TT-2026-I, TT-2026-II + TEAM).
- Both files are the institute's own timetables and need no further review. Each is stored as a `reviewed` snapshot with `complete` coverage for its term. A course that is missing from a term's list is not offered that term.
- The Semester II file is the `Time table` sheet only. It uses the same slot tokens (A1 to P2) as Semester I, so its slots are read with the Semester I `Time Slots` legend. **Team decision:** the institute keeps one slot grid across both semesters.
- A course whose title ends in "(first half)" meets in quads Q1 and Q2 of its term, and one ending in "(second half)" meets in Q3 and Q4 (CAL-2026-27). Every other course meets from the first to the last day of classes for continuing students.
- Unchanged by this decision: whether a lab or tutorial listing several slots needs all of them or one of them (AMB-12) is still unknown, so clashes between such meetings stay possible, never certain.

**D-23. Later terms reuse the same-parity timetable as a hint** (TEAM). Courses offered in an odd semester are usually offered again in the next odd semester, and likewise for even semesters.
- For a I or II term with no timetable of its own, a course listed in the latest earlier timetable of the same parity is shown as `historical`: a planning hint, never a confirmed offering. A course missing from that list stays `unknown`, not "not offered".
- Hints never supply meetings, so clashes in those terms stay `not_checked`. Summer terms get no hint.

**D-24. Academic calendar 2026-27** (CAL-2026-27).
- A term runs from the first day of classes for continuing students to the last day of Examination II.
- Its exam windows are Examination I and II. Make-up examinations are recorded separately, because only some students sit them.
- Quads, the mid-semester recess and the vacations are kept as published. Terms of later years have no dates until the institute publishes them (GAP-03 stays open for 2027-28).

**D-25. Internship timing presets** (TEAM).
- Industrial internships of two or three months start in May. A six-month internship starts in May or in July.
- The presets therefore seed:
  - a summer start on 1 May for three or six months;
  - a July start on 1 July for six months, before the odd semester it overlaps.
- A two-month internship, or any other date, is entered as custom dates.
- Presets only seed dates. The student's exact dates decide every overlap, and length never grants credit (D-14).

## Still open

| Question | Affects | Current behavior |
| --- | --- | --- |
| Can online credits count toward HSS electives (D-13)? | CP-18 | No (kept 7 Nov) |
| SPI of a term whose course was later repeated: unchanged or recalculated? | CP-16 | Unchanged (historical SPI) |
| Are IN 101 to IN 104 the viva records (D-16)? | CP-14, CP-20 | Treated as the viva |
| AI minor document, CSE honours list | none (CP-25 to CP-27 withdrawn) | Out of this release (D-18); awards return `AWARD_POLICY_MISSING` |
| D-02: does a same-named course with fewer credits (old ES 242, 3 credits) satisfy a 4-credit core requirement in the engine? | CP-03, CP-17 | Not yet: a core requirement still needs its full credits |
| Is a P on IN 498 a pass/fail conversion (D-12)? | CP-18 | Counted as a conversion, which reduces the online pool |

## 10. Removing unknowns, and plan generation

Recorded 7 Nov 2026 by Harsh, after the hosted app showed an "unknown" on almost every screen and no way to generate a plan. Each decision below replaces an `unknown` with an explicit, labelled rule. They are TEAM decisions, not institute confirmations. Things that cannot be known before the institute publishes them (later timetables, later calendars) become labelled expectations, never verified facts.

**D-26. Lab and tutorial slot lists are alternatives** (TEAM, Harsh). When a lab or tutorial lists two or more slots, each student is assigned to exactly one of them. Lectures that list several slots meet in all of them (`all_required`). A group the source could not read stays `unknown`. Resolves AMB-12 and replaces the "stay possible" note in D-22. An unpicked alternative that overlaps another course is a *possible* clash; a picked slot is checked as certain.

**D-27. The grade-point table is reviewed.** A+=11, A=10, A-=9, B=8, B-=7, C=6, C-=5, D=4, E=2, F=0; P earns credit and has no points (transcript legend, p. 2). `data/grading/reported-v1.json` is marked reviewed.

**D-28. CPI and SPI display rounding.** The exact fraction is stored; display rounds half up to two decimals. The sample record's 9.23 is unaffected.

**D-29. Imported courses are matched by the approved rules, not by a separate catalogue.** A row is matched when D-05 to D-08, D-19 and D-20 place its code in a requirement (open electives accept any other credit course). Identity groups (D-01 to D-04) resolve variants first. Equivalence notes for CS 203 and CS 421 are shown as "decided by the team (D-03, D-06)", not as unresolved. A row no rule can place stays unmatched and needs review.

**D-30. A course with no recommended prerequisite shows "no recommendation recorded".** This is informational, never an unknown or an error, and it is not "no prerequisites" (amends D-17). The 22 entries in `data/prerequisites/cse-2024-recommended.json` are marked reviewed.

**D-31. Standing defaults to regular.** Until the student sets standing (regular or GPS) and any advisor cap in the profile, plans use the regular 28-credit cap and say so as an assumption. *Amended by D-36 for generated and edited drafts: the limit is 28 and is not mentioned.*

**D-32. Retakes are allowed for every non-project course.** The best grade counts (D-15). A planned retake is an informational note; the same course planned twice in one plan stays a warning. Project courses are always separate attempts (D-01, D-10).

**D-33. Later terms are expectations.** A course in the same-parity timetable (D-23) is labelled "expected, unconfirmed". Offering and calendar facts for terms the institute has not published stay unconfirmed and clashes there stay `not_checked`. *Replaced by D-38 for the years after 2026-27: they follow the supplied timetables.*

**D-34. IN 498 credits count toward the semester load cap** of the term they are registered in. Resolves `INTERNSHIP_LOAD_POLICY_UNKNOWN`.

**D-35. CoursePath generates a draft plan for the remaining degree** (reverses the plan-generation exclusion in roadmap §1 and `docs/team/README.md`; statement CP-35).
- It uses only decided rules: the audit for what remains, D-05 to D-20 for what fits where, the official timetables for what is offered, the recommended prerequisites for ordering, and the load limits.
- It places required core first, then the Theory and Systems minima, then electives, and uses placeholders where no offered course fits. It never invents an offering, an equivalence or a prerequisite.
- Elective picks are suggestions with a stated rule; the student edits the result. Every placement names the requirement it fills and whether the offering is confirmed or only expected.
- It does not save anything by itself; the student saves the draft as a normal plan.

**D-36. A semester holds at most 28 credits, always** (TEAM, Harsh, 7 Nov). Plan generation and the editor for a generated draft use one load limit: 28 credits in a regular semester. No GPS 21-credit limit, advisor cap, overload path or 20-24 guidance is applied there, and none is mentioned to the student. Amends D-31 for generated and edited drafts (`simple_load` in plan checks). Saved-plan validation keeps the ADV13 p. 7 rules (GPS, advisor cap, overload approval) for the statements that promise them (CP-21).

**D-37. Early graduation through an internship semester** *(amended by D-40: no separate early attempt; packing ends the plan early whenever it can)* (TEAM, Harsh, 7 Nov). When the student picks an internship semester that is not the last semester of the standard plan, the generator first tries to finish a semester early: the remaining work is packed into the earlier semesters up to 28 credits; the internship semester holds IN 498 modules (4 credits each, 16 at most, split only over what is still open, D-14) and online courses (D-13) up to the semester's 28 credits and no timetabled courses. The early plan is returned only if every requirement is then either placed or held by something the student arranges (projects, internship modules, online courses); otherwise the standard plan is returned with a plain message. Internship and online credits are proposals the student must arrange and get approved; they are never counted as earned.

**D-38. Later years follow the two supplied timetables** (TEAM, Harsh, 7 Nov). The 2026-27 Semester I timetable is the timetable of every later odd semester and the Semester II timetable of every later even semester (up to five later years). Offerings, slots and clash checks use them like a published timetable, with dates moved by whole years; the student is not shown "expected", "unconfirmed" or "not published" states. Replaces D-33 and the hint-only status of D-23 for those terms; a term the institute later publishes replaces the carried-forward one.

**D-39. The student interface carries no internal references** (TEAM, Harsh, 7 Nov). Decision IDs, issue codes, rule-set names or versions, review status, source locators, record or plan revision numbers, import row counts and notes about assumptions are not shown. Severity `info` is never shown. The degree total (170 for CSE 2024), the credits counted and the credits remaining are shown with an explicit "not yet eligible to graduate" or "graduation requirements complete" verdict; the server supplies those numbers (`audit.degree`).

**D-40. Plans are packed, open-ended electives are held as credits, internship credits are split by need** (TEAM, Harsh, 8 Nov). Amends D-35 and D-37.
- **Packing.** Semesters are filled to the 28-credit limit from the earliest semester, so the plan ends as early as the timetables allow; a student can ask for a lighter plan (about 20 credits). A plan that ends before the usual eighth semester says so (`graduation.early`); there is no separate "early" attempt.
- **Elective credits are held, not named.** For the HSS electives, the Basic Science elective, the general CSE electives and the open electives the plan holds a labelled placeholder of credits ("HSS elective", "Basic Science elective", "CSE elective", "Open elective") that the student fills with any course that counts. Required courses and the baskets with a fixed list (Theory, Systems, Science, Materials, Mathematics) stay real timetabled courses. Placeholders are never counted as earned.
- **Internship credits.** A semester-long internship gives 16 credits as four 4-credit IN 498 modules (D-14: only to open electives, HSS electives (at most 8) and the open project). Each module goes to the narrowest requirement that still needs a full module (open project, then HSS, then open electives), so the flexible open electives keep the most room; a module no requirement still needs is dropped. Basic Science is not an allowed target (ADV13 p. 3). Online courses (D-13) fill the rest of the internship semester for CSE and open electives only (at most 8 and 16 credits).
- **Checking an edited plan** (`POST /plans/check`) reports, per requirement, what is required, counted, held by placeholders and still uncovered, and per semester how many more credits fit under 28.

**D-41. Online credits taken in the breaks can save a semester** (TEAM, Harsh, 8 Nov). Amends D-13 and D-40. Up to 16 credits of online courses count (D-11), taken in the summer breaks (at most 10 credits each, ADV13 p. 7) and in an internship semester. The generator uses them only when they let the plan end earlier: it compares the plan without online credits and with the whole pool, and keeps the smallest amount that ends as early as the whole pool does. Online credits go to the general CSE electives first (together with projects at most 8, D-10) and then to the open electives, never to HSS or Basic Science; each online course is held as an "Online course" placeholder in a summer, the allocator confirming the caps. Only summers before the usual last semester are considered, so a plan can end in a summer.

**D-42. Online courses can be added by hand, may count toward HSS, and can lighten the semesters** (TEAM, Harsh, 8 Nov). Amends D-13 and D-41.
- **By hand.** A student can add an online course to any semester or summer break of a plan: a placeholder marked `online`, with the requirement it is for, its credits and a name the student chooses. Which requirements: HSS electives, Basic Science elective, general CSE electives and open electives ("open, HSS etc." was the instruction; Basic Science is included as "etc." and can be removed if that is wrong).
- **HSS.** D-13 left open whether online credits may count toward HSS electives; the answer is yes.
- **What counts.** The check asks the allocator: at most 16 online credits count (less pass/fail conversions, D-11, and online courses already on the record), and the CSE electives take at most 8 of them together with projects. A plan that has more online credits than count gets a plain warning ("Only 12 of your 16 online credits count toward your degree") and the credits that do not count hold nothing.
- **Lightening.** `lighten_with_online` keeps the plan's last semester, uses the online pool in the breaks and in an internship semester, and spreads the regular work evenly over the same semesters, so the busiest semester gets lighter (28 to 23 in the hand-counted example). It is returned only if it is complete and the busiest semester is lower; otherwise the plan as it was. The plan always reports what online credits could do (`online_potential`): credits still available, the breaks that can hold them and its busiest semester, so the student can see it even when an internship is chosen.

**D-43. UI direction: Mission Control** (TEAM, Harsh, 8 Nov). The whole interface follows one design, "Mission Control" (`docs/design/mission-control.md`): dark theme by default (light is an optional toggle that never follows the system setting), one fixed palette (cyan for progress, amber for limits, violet for what-if, mint for done, red for problems), a display, a body and a monospace face, a command bar on `/` or Ctrl+K, and plain student wording. The palette is closed: no other colours. Awards and achievements (badges for milestones, honours, minors) are not shown or kept anywhere, and there is no prerequisite map. Screens show only real data: nothing animated or listed that the server did not return.

**D-44. Importing again replaces the earlier import** (TEAM, Harsh, 8 Nov). Amends the roadmap's CP-11 text ("requires conflict resolution").
- **Replaces.** A new import (PDF or IMS paste) replaces the rows an earlier import saved, whichever source it came from. A saved imported row the new import repeats unchanged stays as it is, with any correction the student made. One the import changes is updated: it keeps its identity and gets a `reimport` entry in its history. One the new import no longer has is removed. The review page says so before the student confirms ("Updated", "no longer in this import").
- **Never touched.** Rows the student typed in themselves (they carry no source) are kept. If the import changes one of those, it is still a conflict that needs a decision. A row the student leaves out of the review keeps its saved version.
- **Totals.** The totals printed by an earlier import describe the rows it saved, so they are replaced with the new import's (or cleared if it prints none).
- **Why.** Pasting the same transcript twice, or a PDF after a paste, used to fail with "conflict" or "ambiguous attempt identity" on rows that were only the earlier copy of the same transcript.

**D-45. A plan is valid, or not valid, and either can be saved** (TEAM, Harsh, 8 Nov). Amends D-36.
- **Valid** means the plan's check (`POST /plans/check`, the same one that runs after every change to a draft) finds no error-severity problem **and** no degree requirement is left uncovered: `uncovered_credits` is 0 after the plan's courses and the credits its placeholders hold. The server decides and returns it as `status: {valid, problems, uncovered_credits}`; the browser never works it out.
- **Saving.** A draft that is not valid can still be saved (it used to be blocked while the check found an error). Next to the Save button and at the end of the draft the student is told plainly which it is and why ("Not a valid plan yet: 1 problem to fix and 12 credits of your degree not covered yet. You can still save it").
- **The list of plans.** Every saved plan shows "Valid" or "Not valid" beside its name. The status is computed from the plan and the **current** record each time plans are read, so a plan that was valid when saved turns "Not valid" if the record later changes under it (a failed course, a re-import). It is never stored.
- **No empty "My plan".** The Plans page no longer has a button that creates an empty plan; plans start from Generate plan. Editing a saved plan by hand is unchanged.

**D-46. Sign-in is Google, for IITGN accounts only** (TEAM, Harsh, 8 Nov). Amends the roadmap's account decision (username and password).
- **Who.** With `COURSEPATH_GOOGLE_CLIENT_ID` set, only IITGN Google accounts sign in. The browser gets a Google ID token (Google Identity Services); the server checks it with Google's library (signature, audience = our client ID, issuer, expiry) and then requires a **verified** address that ends in `@iitgn.ac.in` **and** a Google Workspace domain claim (`hd`) equal to `iitgn.ac.in`. Anything else is refused with `NOT_IITGN_ACCOUNT`. The domain is fixed in code, not configurable.
- **Accounts.** The first sign-in creates the account, named by the lower-cased address, with no password and an empty record. Later sign-ins reach the same account from any device. An older password account that happens to use the same name is never taken over (`ACCOUNT_CONFLICT`).
- **Passwords.** While Google is configured, password sign-up is off and password sign-in is off too, unless `COURSEPATH_ALLOW_PASSWORD_LOGIN=1` keeps it for accounts made before this change (never for new ones). Without a client ID (local development, tests, the browser suite) the username and password forms work as before. Google accounts have no password to change, so the Account page hides that form for them.
- **Not decided here.** Existing password accounts are not linked to Google accounts; nothing moves data between them.

**D-47. SPI is capped at 10, like CPI** (TEAM, Harsh, 10 Nov). Answers the question in issue #122 (CR-110 item 1). The grade table gives A+ eleven points, so a term of only A+ averages 11; the displayed SPI is capped at 10, the same as the CPI (D-27, D-28). The exact value stays available as `unrounded_value`. `data/grading/reported-v1.json` sets `spi_cap` to `"10"`. This rests on the team's decision; if the institute's rule differs, change the file and this entry together.

**D-53. In "With my plan" the credits a plan keeps in placeholders count, and the requirements say so** (PROPOSED by Manashree, 10 Nov, for Harsh to confirm; applies D-45 to the requirements view). A plan that keeps 4 credits for "Basic Science elective" in a placeholder already counts as covering them for the plan's valid / not valid status (D-45), but the "With my plan" requirements view left them out, so its total and its remaining credits disagreed with the plan. Now `POST /analysis` with a plan returns `plan_holds`: `degree` (the degree total with the kept credits counted, the kept credits, and what remains) and, per requirement or group, the credits kept there (never more than the requirement can still take; a group is the sum of its parts) and the placeholders that keep them. The view shows "kept in placeholders" next to each such requirement, names the placeholder and the semester when it is opened, and says the student still chooses the course. `audit.degree.projected` is unchanged (the plan's courses alone), so the plan page keeps its own wording. Online placeholders are kept where the allocator counts them (D-13, D-42).

**D-54. Courses of the running semester can be added from the requirements view** (PROPOSED by Manashree, 10 Nov, for Harsh to confirm). In "Completed + current courses" the student can add the courses they are taking now, using the same confirmed current enrolment as the record page (a course counts only once the student confirms they are enrolled). The requirements are counted again with the new record revision and list those courses under the requirements they fill, marked "in progress". Nothing is filled in from a transcript.

## Implementation follow-ups

Each item goes through the normal reviewed PR. Owners are from `docs/team/README.md`.

| Item | Decisions | Owner | CPs |
| --- | --- | --- | --- |
| Done 31 Oct (`cse-2024-v1`, reviewed): rewrite `data/curricula/cse-2024.json` from ADV13 with page references; change the source from the roadmap to ADV13 and mark it reviewed | D-05 to D-10, D-14, D-16, D-19 to D-21 | Harsh | CP-01, 03, 17, 18, 19 |
| Done 31 Oct: add a catalogue with D-04 identity groups; resolve D-01 identity before matching (today prerequisites and requirements compare raw codes, so `ES 242(N)` would not satisfy `ES 242`) | D-01 to D-04 | Harsh | CP-03, 13, 17 |
| Done 31 Oct (rounding still open): set `repeat_policy: best_grade` and the always-P/F list; add the online pool and conversion inference. Students cannot mark a course online yet (needs a record field and UI) | D-11, D-12, D-15 | Harsh | CP-14, 15, 16 |
| Done 31 Oct: reword SPEC CP-05 and CP-22 to "recommended prerequisite"; add a recommendation severity (`warning`) and keep `PREREQUISITE_UNKNOWN` for courses without an entry. This is a `[contract]` change | D-17 | Harsh (SPEC, domain), Aaryan (UI wording) | CP-05, 22 |
| Mark AMB-01 to 05, 08, 09, 15 and GAP-04, 05, 09, 10 resolved by these decisions; GAP-06 partly (D-15); AMB-07 and GAP-07 deferred (D-18) | all | Manashree (`docs/data/`) | none |
| Done 31 Oct: report surplus credits per requirement in the audit result, and add a test that a course is never split. `coursepath/rules/allocation.py` already places each attempt whole | D-06, D-07 | Harsh | CP-17 |
| UI: label TEAM decisions, surplus credits, the online pool, inferred P/F conversions and recommended prerequisites | D-07, D-11, D-12, D-17 | Aaryan | CP-14, 17, 18, 22 |
| Done 3 Nov: commit the official 2026-27 timetables and calendar, build reviewed snapshots with half-semester dates, serve them without a load step, add the same-parity hint and `GET /calendar` with presets | D-22 to D-25 | Harsh | CP-23, 24, 33 |
| UI: fill internship presets from `GET /calendar`; show `historical` offerings as hints | D-23, D-25 | Aaryan | CP-23, 33 |

## Superseded text

- Roadmap §3.2 and §5 "never silently resolve a conflict by title similarity": D-01 replaces this with the exact-normalized-title rule. Partial matches still need review.
- Roadmap §3.2: CS 203 vs CS 202 is resolved (D-03); SC 372 is resolved (D-08); the CS 299 counting is resolved (D-10).
- Roadmap §3.1 "Comprehensive viva ... Seek clarification": resolved (D-16).
- Roadmap §5 and contracts §6 "at most 4 credits per quad": not modelled (D-14).
- Roadmap §11 prerequisites row: no institute document exists; replaced by D-17.
- `docs/team/README.md` and roadmap §1 "no automatic plan generation": replaced by D-35 (CP-35).
- D-17 "a course without an entry is still `unknown`": replaced by D-30 (shown as "no recommendation recorded", informational).
- D-22 last bullet and AMB-12 "lab/tutorial alternatives are unknown": replaced by D-26.
- AMB-06 rounding: replaced by D-28. Roadmap §11 grading row: D-27.
