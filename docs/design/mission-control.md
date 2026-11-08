# CoursePath Mission Control

The design of the student interface (decision D-43). The visual concept is `mission-control-concept.html` in this folder; the real tokens are in `frontend/src/styles/tokens.css` and the shared styles in `frontend/src/styles/global.css`.

## Rules

- **Dark is the default.** The page is dark whatever the system prefers. Light is an optional toggle (top bar or command bar) remembered in this browser (`coursepath-theme`); `index.html` applies it before first paint so nothing flashes.
- **One palette, closed.** No other colours anywhere. Tints are made with `color-mix()` on these tokens only. No gradients or glow, except focus rings and the faint grid lines of the page background.
- **No awards, no achievements, no milestone badges, no prerequisite map.** The Awards tab and page do not exist; `/awards` is a normal "Page not found".
- **No fake data.** Nothing is animated, listed or counted that the server did not return. Counters, bars and rings draw server numbers; the browser never computes an academic result.
- **Student words.** No decision IDs, issue codes, rule names, revision numbers or "unknown" jargon on screen.

## Palette roles

| Token | Role |
| --- | --- |
| `--bg`, `--bg2`, `--panel`, `--line`, `--grid` | page, quiet surface, raised surface, hairlines, background grid |
| `--fg`, `--muted` | text, supporting text |
| `--accent` (cyan) | your progress, links, active tab, primary button |
| `--ok` (mint) | done, satisfied |
| `--warn` (amber) | limits, things to check |
| `--bad` (red) | problems, destructive actions |
| `--whatif` (violet) | what-if scenarios, credits held for the student to fill |
| `--ok-text`, `--warn-text`, `--bad-text`, `--whatif-text`, `--accent-strong` | the tones for coloured text: they pass AA contrast on every surface in both themes; fills and borders use the plain tones |

The older names (`--surface`, `--border`, `--text`, `--success`, `--warning`, `--danger`, `--scenario`) are aliases of these, so existing components follow the palette.

## Type roles

- **Display** (`--font-d`, Chakra Petch 500/600): headings, the wordmark, big numbers. `h2` is a small uppercase letter-spaced accent label.
- **Body** (`--font-b`, IBM Plex Sans 400/500): reading text. "Bold" means 500.
- **Mono** (`--font-m`, JetBrains Mono 400/500): course codes, credits, grades, tags, tabs, the command bar. Numbers use tabular numerals.

Fonts are self-hosted (`@fontsource`), so the app makes no third-party requests.

## Utilities (global.css)

`.panel`, `.panel-head`, `.section-label`, `.mono`, `.num`, `.tag[data-tone]`, `.meter[data-tone]` (with an `<i>` fill), `.chip`, `.chip--placeholder`, `.pill-ok|warn|bad|whatif`, `.problem-list` with `.sev[data-sev]`, `.readout`, `.grid-board`, `.heat` and `.heat-cell[data-level]`, `.kbd`, `.icon-btn`, plus the existing `.btn`, `.callout[data-tone]`, `.badge-*`, `table.data`.

## Command bar

`/` (outside a text field) or Ctrl/Cmd+K opens it from anywhere. It lists real commands only: the main pages, importing the record, generating a plan, the theme, signing in or out. Type to filter (every word must match), arrow keys to move, Enter to run, Escape to close.

## Quality bar

AA contrast on every surface in both themes, visible focus rings, `prefers-reduced-motion` turns off transitions, touch targets of at least 44px for primary controls, no horizontal page scroll at 390px, reports print black on white.
