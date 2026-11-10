# What to commit for the implementation plan

The planning branch is `project-implementation-plan`. Branch creation carries the current working tree onto the new branch; it does not commit, stage or push files. Commit the reviewed bundle while this branch is checked out. Main's commit history has not been changed by this planning work.

## Commit now

These are the planning changes from this work:

- `.gitignore` — adds exact ignores for the three personal input files below.
- `docs/implementation-roadmap.md` — product/architecture/rule/acceptance plan.
- `docs/team/README.md` — ownership, independent work, dependencies and checkpoint schedule.
- `docs/team/contracts.md` — shared schema, domain and API interfaces.
- `docs/team/harsh.md` — Harsh's ordered tasks and acceptance criteria.
- `docs/team/aaryan.md` — Aaryan's ordered tasks and acceptance criteria.
- `docs/team/manashree.md` — Manashree's ordered tasks and acceptance criteria.
- `docs/team/source-findings.md` — workbook findings and independently justified regression cases.
- `docs/team/commit-guide.md` — this guide.

Also include these existing untracked assignment-reference files in the same commit so the plan's assignment source is available to the team:

- `problem.md`.
- `docs/reference/hackathon-2026-10-09.html`.

The existing `docs/submissions/2026-10-09.md` may be included as a **historical preparation note**. Its original statements about the remote reflect preparation time; it is not current proof of repository settings or submission. It is not required for the new implementation plan. Do not change dates or invent completed submission evidence.

## Official source workbooks/PDFs

- `Adv13_Norms for BTech Programme_28 Jan 2026.pdf`: useful to commit as the official rule reference used by this project. It is not one of the personal records ignored below.
- `Timetable, Sem-I, 2026-27.xlsx`: useful to share with all three teammates as the source for timetable ingestion. The raw workbook contains working metadata and course-plan links. For a public source bundle, prefer the reviewed course/slot snapshot and a source manifest; keep the original in the team's shared source materials if those working details should not be republished. Do not claim the normalized snapshot exists yet.

Neither official source file is newly authored or modified by the planning work. They are optional additions to this **planning commit**; make them available to the teammates who need source review/ingestion through the repository or shared team source materials. The public app and CI must eventually run on committed reviewed/anonymized data without needing a particular student's private originals.

## Keep local / skip committing

These three inputs contain a student's academic record and now have exact `.gitignore` entries:

- the sample transcript PDF (named after the roll number; matched by `[0-9]*B.Tech*.pdf`).
- the example graduation plan workbook (matched by `[0-9]*_Graduation Plan.xlsx`).
- `copied_input.txt`.

Use consented anonymized fixtures in tests instead. Paths to private inputs in the planning documents identify local review sources; do not expect those links to resolve in a fresh public clone. The plan explicitly requires synthetic/anonymized committed fixtures during implementation.

Also skip `.env`, passwords/keys, local databases, uploads, generated PDF/image extracts, virtual environments, dependency directories, build output, caches and private browser traces/screenshots. Existing ignores cover several of these; add exact appropriate ignore entries when new generated paths are introduced. Do not assume every future cache/build path is already ignored.

Root `Plan.md` is already ignored and is an older local context document. Use the new roadmap/team files as the shared plan; do not force-add the old file.

## Suggested staging commands

Run from repository root on `project-implementation-plan`. These commands deliberately leave source PDFs/XLSX and the historical note as separate choices:

```powershell
git add -- .gitignore docs/implementation-roadmap.md docs/team/README.md docs/team/contracts.md docs/team/harsh.md docs/team/aaryan.md docs/team/manashree.md docs/team/source-findings.md docs/team/commit-guide.md problem.md docs/reference/hackathon-2026-10-09.html
git diff --cached --stat
git diff --cached --check
git status --short
```

Optional source/historical additions, independently:

```powershell
git add -- 'Adv13_Norms for BTech Programme_28 Jan 2026.pdf'
git add -- 'Timetable, Sem-I, 2026-27.xlsx'
git add -- docs/submissions/2026-10-09.md
```

Review staged contents, then make your own commit, for example `git commit -m "Document CoursePath implementation plan and team checkpoints"`. Nothing has been staged or committed on your behalf by this planning task. Use a reviewed pull request to bring the eventual commit into main.
