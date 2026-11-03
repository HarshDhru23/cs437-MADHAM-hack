# User-test session script (M09)

For the moderator. Participants: Aayush Kuloor and at least one other B.Tech student outside the team, arranged by a team member in person. Nobody is contacted automatically. **No session has been held yet (3 Nov 2026).** Record only what is observed in [observations.md](observations.md); never paraphrase it into a success claim.

## Before the session

- Run the app from a fresh database: hosted URL if one exists, otherwise `python scripts/run.py` (local fallback, say so in the notes).
- Use synthetic inputs only: the IMS sample shown on the import page, or the synthetic PDF built by `e2e/fixtures/make_synthetic_pdf.py`. A participant may use their own record only on their own device and account; never record their grades, name or roll number in notes or screenshots.
- Note the commit SHA, browser, device and screen size.
- Have a stopwatch. Time from "start" to the participant saying the remaining requirement out loud.

## Consent (read aloud)

"We are testing CoursePath, not you. It takes about 20 minutes. We will write down what you do and say, but not your name, grades or roll number, and we will not record the screen. You can stop at any time."

## Tasks

Give one task at a time. Do not explain the interface. If the participant is stuck for 60 seconds, give the hint and record that you did.

| # | Task (read this) | Promise checked | Done when | Hint after 60 s |
| --- | --- | --- | --- | --- |
| 1 | "Without signing in, find out how many HSS credits a CSE 2024 student needs and where that rule comes from." | CP-01, CP-19 | says 28 and opens the source | "Look at the requirement list." |
| 2 | "Create an account and bring in the sample grades." | CP-07, CP-08, CP-29 | review screen shows the rows | "There is a paste option." |
| 3 | "Is anything flagged? Fix or explain one flagged row, then confirm." | CP-08, CP-12, CP-13 | one flagged row handled, record confirmed | "Issues are listed first." |
| 4 | "Pick one requirement that is not finished. Tell me why, and which courses count toward it." | CP-03, CP-19, CP-20 | correct requirement and reason stated | "Open a requirement row." |
| 5 | "Add a course to next semester, then move it to the semester after. Did anything warn you?" | CP-04, CP-05, CP-22 | course moved, warning read | "Use the plan table." |
| 6 | "Plan PH 202 and ES 667 in the same term. Is there a problem?" | CP-24 | states that the lectures clash | **Not testable on `main` today** (A08 clash UI unmerged); skip and note it |
| 7 | "Compare no internship, 3 months and 6 months. What changes for credits and courses?" | CP-33, CP-34 | states that duration alone gives no credit | **Not testable on `main` today** (Scenarios page is a placeholder); skip and note it |
| 8 | "How far along are you with the AI minor?" | CP-26 | finds the awards view | **Not testable**: award definitions missing (GAP-07) |
| 9 | "What is the CPI, and which courses are left out of it?" | CP-15, CP-16 | names the CPI and the P-graded exclusions | "Look under My record." |
| 10 | "Open the same account in another browser window. Is your plan there?" | CP-29 | sees the saved plan | "Sign in again in a private window." |

## Measures per task

Completed (yes / with hint / no), time in seconds, errors (wrong clicks, wrong answers), what they said, what confused them. The roadmap's two-minute first-audit target (tasks 2-4, excluding sign-up) is a measurement, not a result to pre-write.

## After the session

Ask: "What would stop you from trusting this plan?" and "What was missing?" Write their words, not a summary. File each problem as an issue with the task number and owner (UI: Aaryan; numbers or rules: Harsh; data and setup: Manashree).
