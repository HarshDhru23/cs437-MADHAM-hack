# The Open Hackathon

Source: <https://anup.github.io/courses/cs437-2026-27-sem1/hackathon/>

Retrieved: 9 October 2026. The assignment content below preserves the page's wording; only HTML formatting has been converted to Markdown. The original HTML is saved in [docs/reference/hackathon-2026-10-09.html](docs/reference/hackathon-2026-10-09.html).

---

Group project · 5 October to 17 November

Your group builds one piece of software of its own choosing, and keeps building it until the end of the semester. On Monday 16 November, someone outside your group will ask your software for a new feature in plain English. Your group builds it, and your own tests decide whether it is accepted. Build with that day in mind.

## 1. What you can build

Almost anything, if it passes three tests:

- **It has a real user:** a student, a mess committee, a club, a shopkeeper, a parent, a lab. Name them.
- **That user can use it without touching code:** a web page, a phone-friendly site, a bot.
- **It can grow.** A new feature request must have somewhere to go. A tool that does one fixed calculation has nowhere to grow.

Some shapes that work: booking a shared room or a court; a lost-and-found board; a mess menu with ratings; a club's event sign-ups; splitting bills in a hostel wing. Your own idea is better than any of these.

Your team is your current group.

## 2. The rules

| | |
| --- | --- |
| 1 | **One new repo per group**, named `cs437-<group>-hack`, with both instructors as collaborators. Branch protection on `main`: every change arrives by a pull request that another member reviewed. |
| 2 | **Spec before code.** `SPEC.md` says who the user is and lists what they can do, one checkable statement per line: "A student can book a court for a one-hour slot"; "Two students cannot book the same slot". |
| 3 | **Tests before features.** Every line of `SPEC.md` has at least one automated test. A feature is done when its test passes *and* it works when you try it as your user would. Looking right is not enough, and neither is a passing test that checks the wrong thing. |
| 4 | **One command to run, one to test.** The README gives both. Someone who clones the repo on a fresh laptop must get it running from the README alone. |
| 5 | **No secrets in the repo.** API keys go in a `.env` file that `.gitignore` lists. A committed key breaks this rule even if you delete it later: git history keeps it. |
| 6 | **Everyone commits.** The group's work counts only for members with a merged pull request. |
| 7 | **AI is allowed everywhere.** Log how you used it in `lab-notes/class-NN.md` in your own repo, as usual, naming the part you built. |

## 3. Your idea, by tonight

By **tonight, Monday 5 October, 23:59**, one person per group posts your idea in the CS437 space, in three sentences:

1. Who the user is.
2. What they do today, without your software.
3. What your software changes for them.

We approve ideas on Tuesday 6 October. If two groups post the same idea, the group that posted first builds it, and the other picks something else. During this week, talk to your user and write one thing they said at the top of your `SPEC.md`.

## 4. Checkpoints

Class time also goes to other work until November, so most of this happens outside class. We check your repo on each date.

| | |
| --- | --- |
| Mon 5 Oct | Kickoff in class: pick your user and your idea. |
| Mon 5 Oct, 23:59 | Idea posted. |
| Tue 6 Oct | Ideas approved. |
| Fri 9 Oct | Repo created, branch protection on, both instructors invited. `SPEC.md` with one thing your user said, and at least five statements. One test, for one statement, running and failing. |
| Fri 16 Oct | `SPEC.md` with at least ten statements. A test for every statement; all may still fail. It runs. |
| Tue 27 Oct | At least half the statements green, each merged through a reviewed pull request. A stranger can run it from the README. |
| Tue 3 Nov | Every statement green. The spec is frozen. |
| Mon 2 – Tue 10 Nov | Four class sessions for the hackathon: review another group's pull requests, fix what they find, make the tests honest. |
| Mon 16 Nov | **Acceptance run.** Someone outside your group asks for a feature your group has not seen. You write it into `SPEC.md`, add its tests, and build it. Your test suite decides. |
| Tue 17 Nov | Demos. |

## 5. How it is judged

- **The acceptance run.** Was the new feature built in the time, and do your tests really check it?
- **Honest tests.** We will break something your spec promises. Do your tests notice?
- **The process.** Spec first, tests first, reviewed pull requests, every member committing. All of it visible in `git log`.
- **The user.** Would the person you named actually use it?

A more ambitious project can earn more marks, but only if it is complete. How much the hackathon counts will be announced with the course grading policy.
