# Academic decisions for CSE 2024

Recorded 29 October 2026. Decided by Harsh for the team, from the January 2026 advisory and the team's own knowledge of IITGN practice. Scope: B.Tech CSE, students admitted in AY 2024-25.

These decisions are the approved interpretation for building CoursePath. Where a decision below conflicts with `docs/implementation-roadmap.md` §3 or §5, this file wins (see [Superseded text](#superseded-text)). A decision marked **team decision** is the team's reading or practice, not a quoted institute rule. The app must label it that way to students, and it should be confirmed with a faculty advisor when one is available.

## Sources

| ID | Source | Used for |
| --- | --- | --- |
| ADV13 | Academic Affairs Advisory No. 13, *Norms for BTech Programme* (January 2026). Local, git-ignored copy. | pp. 1-4 institute curriculum, project, exposure and viva; p. 6 honours/minors; p. 7 load, project cap, short courses; pp. 14-15 CSE core and electives; p. 23 CSE 2024 sample path |
| CSE-CAT | CSE course catalogue, <https://cse.iitgn.ac.in/academics/courses/>, retrieved 29 Oct 2026 | Current codes, titles and credits |
| TT-2026-I | Supplied timetable workbook, Semester I 2026-27. Local, git-ignored copy. | Codes and titles offered this term |
| TEAM | Team decision, Harsh, 29 Oct 2026 | Where the advisory is silent or needs interpreting |

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

**D-03. CS 203 is not CS 202.** CSE-CAT and TT-2026-I list both in the same term with different titles: CS 202 "Software Tools and Techniques for CSE" and CS 203 "Software Tools & Techniques for AI". CS 203 does **not** satisfy the CS 202 core, which stays pending until CS 202 is passed. CS 203 credits count as an **open elective** (D-07).

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

**D-06. Discipline electives: 26 credits, only from this list** (ADV13 p. 15 + TEAM). At least 8 credits must come from the Theory & Algorithms basket and at least 8 from the Systems basket. Basket credits count inside the 26, not on top of it. Same-course codes from D-04 also qualify.

| Group | Courses |
| --- | --- |
| General | ES 335, ES 404, ES 615, ES 627, ES 637, ES 645, ES 659, ES 661, ES 666, ES 667, ES 669, ES 670, ES 676 |
| Theory & Algorithms basket | ES 301, CS 614, CS 617, CS 328 |
| Systems basket | CS 327, CS 332, CS 431, CS 432, CS 434, CS 435, CS 615, CS 616, ES 668 |

p. 15 lists the rows "All CS Elective Courses" and the courses above as a "tentative" list. **Team decision:** the "All CS Elective Courses" row does **not** make other CS courses discipline electives (D-07). Read literally, the advisory could allow more, so this reading may undercount discipline electives for a student who took unlisted CS courses. The audit must cite TEAM for this rule, and it should be confirmed with a faculty advisor.

**D-07. Every other CS course is an open elective** (TEAM). This includes CS 203, CS 421 Information Security, CS 613 Natural Language Processing and CS 437. It excludes the core courses (D-05) and project courses (D-09). Open electives total 16 credits (ADV13 p. 2, item 9).

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

**D-15. Repeated courses: the best grade counts** (TEAM). When a course (by D-01 identity) has several graded attempts, only the highest-grade attempt enters CPI and earns credit. The others stay on the record, marked superseded. Project and special-topics registrations are separate courses (D-01 exceptions), not repeats.

Grade points stay as in `data/grading/reported-v1.json` (A+ = 11 through F = 0, E = 2, P excluded from CPI, CPI shown with a maximum of 10). An unrepeated E or F stays in CPI with its points.

**D-16. The comprehensive viva needs a P in every active semester** (TEAM; stricter than the literal ADV13 p. 4, item 18(d)). An F or a missing viva grade in any active semester leaves the requirement unsatisfied, and the student must clear it in the next active semester (p. 4, item 18(b)). *Open:* confirm that IN 101 to IN 104 on the transcript are the per-semester viva records.

## 6. Prerequisites

**D-17. Prerequisites are team recommendations, not institute rules** (TEAM). Neither ADV13, CSE-CAT nor the institute catalogue publishes prerequisites. CoursePath uses a team-curated list:
- The draft is in `data/prerequisites/cse-2024-recommended.json`, marked `draft` until the team approves it.
- The UI calls them **"recommended preparation (CoursePath team)"**.
- An unmet recommendation is a **warning that never blocks** a plan. Don't use the `error` severity that `semester_plan.py` currently gives `PREREQUISITE_MISSING`.
- A course without an entry shows "no recommendation recorded". That is still `unknown`, never "no prerequisites".
- Every recommendation is checked against the ADV13 p. 23 sample path: two courses that p. 23 schedules in the same semester never require each other.

## 7. Deferred

**D-18. AI minor and CSE honours are deferred** (TEAM, 29 Oct). Neither CSE-CAT nor ADV13 has the AI minor document or the CSE honours course list; p. 6 gives only the 20-credit framework. CP-25, CP-26 and CP-27 stay red until those documents arrive.

## Still open

| Question | Affects | Current behavior |
| --- | --- | --- |
| Can online credits count toward HSS electives (D-13)? | CP-18 | No |
| Are IN 101 to IN 104 the viva records (D-16)? | CP-14, CP-20 | Treated as the viva, labelled TEAM |
| SPI of a term whose course was later repeated: unchanged or recalculated? | CP-16 | Unchanged (historical SPI) |
| CPI display rounding (2 decimals, round or truncate?) | CP-15 | Unrounded value stored, 2 decimals shown |
| Is the D-06 reading of "All CS Elective Courses" right? | CP-17 | D-06 |
| AI minor document, CSE honours list | CP-25 to CP-27 | Deferred (D-18) |

## Implementation follow-ups

Each item goes through the normal reviewed PR. Owners are from `docs/team/README.md`.

| Item | Decisions | Owner | CPs |
| --- | --- | --- | --- |
| Rewrite `data/curricula/cse-2024.json` from ADV13 with page references; change the source from the roadmap to ADV13 and mark it reviewed | D-05 to D-10, D-14, D-16 | Harsh | CP-01, 03, 17, 18, 19 |
| Add a catalogue with D-04 identity groups; resolve D-01 identity before matching (today prerequisites and requirements compare raw codes, so `ES 242(N)` would not satisfy `ES 242`) | D-01 to D-04 | Harsh | CP-03, 13, 17 |
| Set `repeat_policy: best_grade` and the always-P/F list in `data/grading/reported-v1.json`; add the online pool and conversion inference | D-11, D-12, D-15 | Harsh | CP-14, 15, 16 |
| Reword SPEC CP-05 and CP-22 to "recommended prerequisite"; add a recommendation severity (`warning`) and keep `PREREQUISITE_UNKNOWN` for courses without an entry. This is a `[contract]` change | D-17 | Harsh (SPEC, domain), Aaryan (UI wording) | CP-05, 22 |
| Mark AMB-01 to 05, 08, 09, 15 and GAP-04, 05, 09, 10 resolved by these decisions; GAP-06 partly (D-15); AMB-07 and GAP-07 deferred (D-18) | all | Manashree (`docs/data/`) | none |
| UI: label TEAM decisions, the online pool, inferred P/F conversions and recommended prerequisites | D-06, D-11, D-12, D-17 | Aaryan | CP-14, 18, 22 |

## Superseded text

- Roadmap §3.2 and §5 "never silently resolve a conflict by title similarity": D-01 replaces this with the exact-normalized-title rule. Partial matches still need review.
- Roadmap §3.2: CS 203 vs CS 202 is resolved (D-03); SC 372 is resolved (D-08); the CS 299 counting is resolved (D-10).
- Roadmap §3.1 "Comprehensive viva ... Seek clarification": resolved (D-16).
- Roadmap §5 and contracts §6 "at most 4 credits per quad": not modelled (D-14).
- Roadmap §11 prerequisites row: no institute document exists; replaced by D-17.
