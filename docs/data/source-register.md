# Source register (M01)

Machine-readable twin: [`data/source-manifest.json`](../../data/source-manifest.json) (checked by `tests/reference/test_source_manifest.py`).

**Read this first.** Only the roadmap, team docs and the hackathon page are committed. On 26 Oct the transcript, IMS paste and advisory PDF were supplied locally (git-ignored, never committed) and hashed; the transcript and IMS rows were checked against a hand-transcribed oracle kept locally as `real_transcript_oracle.json` (git-ignored, never committed). The committed `tests/reference_fixtures/synthetic_transcript_rows.json` copies only its structure and the roadmap controls. The advisory's page map is still from the roadmap, not re-read. The timetable and graduation-plan workbooks have not been supplied. Every review state remains `draft` until Harsh reviews. Items marked *not recorded* still need the owner's file.

| Source ID | Title | Kind / authority | Cohort / term | Effective / revision date | Hash or URL | Locator | Review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SRC-ADVISORY` | Norms for B.Tech Programme (Adv13) | advisory / institutional | 2022-onward; CSE 2024 entry | 28 Jan 2026 (from the title as cited in the roadmap; unchecked) | sha256 `80d59bd2…c0861e` (local file) | pp. 1-4, 6, 7, 8-9, 10, 14-15, 23 (page map from roadmap §3) | draft |
| `SRC-TRANSCRIPT` | Sample B.Tech transcript | transcript / institutional | 2024 entry, semesters 1-4 | unknown (record ends June 2026 per roadmap) | sha256 `d33d1f04…2ffa5`; never commit | pp. 1-2; legend p. 2 (rows checked) | draft |
| `SRC-IMS` | IMS grade-table paste | paste / student-provided | 2024 entry, semesters 1-4 | unknown | sha256 `cf9d826b…aaf2`; never commit | whole paste (rows checked) | draft |
| `SRC-TIMETABLE` | Timetable, Sem-I, 2026-27 | timetable / authority not established | 2026-27-I only | unknown; file name is not an effective date | recorded by `build_timetable.py` at ingestion | `Time table`, `Time Slots!A1:F8`, `Availability` | draft |
| `SRC-GRADPLAN` | Example graduation plan | student example / not authority | 2024 entry | unknown | *not recorded* | `Graduation Plan`, `Course Basket Summary till 4th ` (trailing space), `Sheet1` | draft |
| `SRC-HACKATHON` | CS437 Open Hackathon page | course assignment | CS 437 | unknown (file name says 2026-10-09) | sha256 `b6a5c51c…92c8` | `docs/reference/hackathon-2026-10-09.html` | draft |
| `SRC-CALENDAR` | Academic calendar 2026-27 | institutional (web) | 2026-27 | not recorded | https://iitgn.ac.in/academics/calendar/acadcal-2026-27 | term/quad boundaries | draft, **not fetched** |
| `SRC-CSE-WEB` | CSE B.Tech overview | institutional (web) | general | not recorded | https://cse.iitgn.ac.in/academics/btech/ | page | draft |
| `SRC-CSE-CATALOGUE` | CSE course catalogue | institutional (web) | general | not recorded | https://cse.iitgn.ac.in/academics/courses/ | page | draft |
| `SRC-INST-CATALOGUE` | Institute course catalogue | institutional (web) | general | not recorded | https://iitgn.ac.in/academics/courses | page | draft |
| `SRC-CURRICULUM-WEB` | Institute curriculum overview | institutional (web, secondary) | general | not recorded | https://iitgn.ac.in/academics/btech-curriculum | page | draft |
| `SRC-TENTATIVE-LIST` | 2026-27 tentative course list | institutional | 2026-27 | not recorded | https://iitgn.ac.in/assets/pdfs/Timetable26-27.pdf | whole PDF (titles only) | draft |
| `SRC-AI-MINOR` | CSE/AI minor document | institutional | not known | not recorded | https://cs.iitgn.ac.in/Minor_Dual_Major%20in%20CSE_AI.pdf | **not read** (retrieval failed per roadmap) | draft, **missing** |

## Rules followed

- Download or modified time is never used as an effective date. Where no date is stated the cell says so.
- Originals were not touched. The adapter opens workbooks read-only and never saves them.
- Student-identifying records stay local, including any row-level transcription of them: a real grade history is identifiable even without the name because the source file name carries the roll number. Fixtures under `tests/reference_fixtures/` hold synthetic rows and documented totals only, and `tests/reference/` checks the fixtures for roll numbers, e-mail addresses and absolute paths.
- Web sources carry a URL only; "retrieved" dates belong to whoever fetches them, so they are blank here rather than copied from the roadmap.

## Open items

Gaps affecting sources are tracked in [data-gaps.md](data-gaps.md); rule conflicts in [ambiguities.md](ambiguities.md). Contract note: `SourceReference.kind` has no value for calendars or catalogues; they are recorded as `advisory` until Harsh decides (AMB-14).
