# Traceability: Rawan (relghali)

**Target feature:** View Project Structure (Ctrl+P → "View project structure").

Logic: `packages/script/src/project-structure.ts`
TUI dialog: `packages/tui/src/component/dialog-project-structure.tsx`
Property tests: `packages/script/test/project-structure.relghali.property.test.ts`

Evidence IDs come from my P4A interviews: `C-` classmate, `S-` course staff, `O-` outside developer.

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4B? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | O-11, O-12, C-12, S-20, S-21 | By default `node_modules`, `.git`, `dist`, `build`, `out`, `.turbo`, `.cache`, `coverage` are hidden at every level. Other dot-folders like `.github` are shown. A "Hidden folders" menu lets the user toggle each name or "Show all folders". The choice is saved across restarts. | Given `node_modules/x.js`, `src/node_modules/y.js`, `src/index.ts`, `.github/workflows/ci.yml`: by default the root shows `.github/` and `src/` only, and `src/` shows only `index.ts`. With `node_modules` toggled off, it appears in both. With "Show all folders" on, all 8 appear. The choice survives a restart. | Yes | Hidden folders never appear, all others do (invariant) | `R1: hidden folders never appear at any level, all others do` |
| R2 | C-5, C-6, C-8, C-9, O-6, O-8 | Each level lists only the open folder's direct children, folders first, then files. Each group is sorted by name ignoring case; names that differ only in case are ordered by character code. | Given `src/a.ts`, `src/lib/b.ts`: the root shows only `src/`, and `src/` shows `lib/`, `a.ts`. Given `Docs/`, `lib/`, `README.md`, `apple.ts`, `Zebra.ts`: the order is `Docs/`, `lib/`, `apple.ts`, `README.md`, `Zebra.ts`. | Yes | Each level matches a path-prefix oracle (model/oracle) | `R2: every level lists exactly its direct children, folders first, case-insensitive order` |
| R3 | C-17, C-18, O-13, O-14, S-23 | Opening a folder and then selecting `../` shows the same entries as before, with the folder just left highlighted. | At the root, open `packages/`, then `../`: the same root listing, with `packages/` highlighted. | No | Open then `../` returns to the same listing and highlight (round-trip) | `R3: opening a folder then ../ restores the listing and highlights the folder left` |
| R4 | S-24, S-25, S-26, O-16, O-19, C-9 | Folders open at any depth, and each is read when opened. At 2+ levels deep, the list shows `../` and "Back to project root". At 1 level deep, only `../` ("Up to project root"). | In `packages/tui/src/`: `../` opens `packages/tui/`, and "Back to project root" opens the root. In `packages/`: only `../`. `packages/tui/src/component/` can be opened. | Yes | Navigation rows depend only on depth (invariant) | `R4: a root shortcut appears exactly when two or more levels deep` |
| R5 | C-10, C-11, S-8, S-14, S-15, O-20 | In one folder, 3+ doc files (`.md`, `.mdx`, `.txt`) named `<stem>.<lang>.<ext>` (`<lang>` = 2–3 letters) with the same stem and extension are shown as one row, `<stem>.*.<ext> (N files)`, which opens to list them. Source files are never grouped. | `README.md`, `README.ar.md`, `README.de.md`, `README.fr.md` → rows `README.md` and `README.*.md (3 files)`. Only `README.md` and `README.ar.md` → no group. `auth.test.ts`, `auth.spec.ts`, `auth.util.ts` → no group. | Yes | Not tested in P4B (deferred) | — |
| R6 | S-29, C-19, C-20, O-17, O-18 | Reopening the view in the same session shows the last open folder with the same entry highlighted. If that folder was deleted, it opens the nearest parent that still exists. | Open `packages/tui/`, highlight `src/`, close and reopen: `packages/tui/` with `src/` highlighted. Delete the last open folder, then reopen: its parent is shown. | Yes | Not tested in P4B (deferred) | — |
| R7 | S-9, S-10, S-11 | A purpose comment appears only for names in the known-name list (case-insensitive). Other names get no comment. | `README.md` → "project overview and usage documentation", `SRC/` → "main application code". `nix/`, `constructor/` → no comment. | No | Label is the known one or nothing (invariant) | `R7: only known names get a purpose label, matched case-insensitively` |
| R8 | C-21, C-22, C-26, O-24, S-18 | Adding files inside existing folders never changes the root listing. Opening the view reads only the root folder. | Record the root listing of a repo with `src/`, `docs/`, `test/`. Add files at any depth inside them: the root listing is unchanged. | Yes | Adding nested files keeps the root listing (metamorphic) | `R8: adding nested files never changes the root listing` |

All tests are in `packages/script/test/project-structure.relghali.property.test.ts`.

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R4, R7, R8 (drafted with Claude Code; I reviewed each one).

## Requirement changes

| ID | Original requirement (P4A) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 | Dependency, build, and VCS folders (`node_modules`, `.git`, `dist`, `build`, `out`, `.turbo`, `.cache`, `coverage`) never appear at any level of the view, however deep they are. Other dot-folders such as `.github` are still shown. | Hidden by default, with a menu to toggle each name or show all, saved across restarts. | **Conflict:** O-11 wanted them hidden, but S-20 said "everything should be there". It depends on the user, so the user chooses. |
| R2 | Each level of the view lists only the direct children of the open folder, folders first and then files, each sorted by name. Nested files never appear in an ancestor's listing. | Same, but sorted ignoring case, with a character-code tie-break. | **Checkability:** "sorted by name" didn't say whether case matters, so a test couldn't decide which order is correct. |
| R4 | When the open folder is 2 or more levels below the root, the top of the list shows a "Back to project root" row as well as `../`. Selecting it shows the root listing. At 1 level deep, only `../` is shown. | Same, but folders can be opened at any depth, each loaded when opened. | **Feasibility:** the view stopped at 2 levels, so the shortcut only saved one click. S-25 said it isn't needed at 2 levels, and S-26 wanted it for deeper. |
| R5 | Within one folder, 3 or more files named `<stem>.<variant>.<ext>` that share the same stem and extension are shown as a single grouped row, `<stem>.*.<ext> (N files)`. Opening the group lists those files. The plain `<stem>.<ext>` file keeps its own row. | Only doc files with a language-code variant are grouped. | **Feasibility:** names can't tell translations from other variants. In our repo it would hide source files like `auth.test.ts` and 41 `sst-env.*.ts` files. |
| R6 | Closing the view and reopening it on the same repo in the same session shows the folder that was last open, with the same entry highlighted. | Same, plus: if that folder was deleted, open its nearest existing parent. | **Feasibility:** a deleted folder can't be reopened, and the original didn't say what to do then. |
| R8 | Adding files inside existing folders never changes the root listing, and the view shows its first listing within 1 second, even for a project with 10,000 files. | The root listing never changes, and opening reads only the root folder (no time limit). | **Checkability:** a 1-second limit depends on the machine and would fail randomly in CI. Reading only the root keeps it fast, and that can be tested exactly. |

**Kept:**
- **R3:** C-18 and O-14 wanted the folder just left highlighted; S-27 wanted the top. I kept R3 (2 of 3 interviewees). S-27's need to get out fast is covered by R4.
- **R7:** feasible and testable as written. S-12 and S-13's idea of marked guesses is deferred.

## Triage log

| Property | Counterexample / failure | Outcome | Fix |
|---|---|---|---|
| R2 | `src/src/` with `lib` and `README.md` was listed as `README.md, lib` | Code bug | Sort ignoring case (`compareNames`) |
| R7 | `["constructor", "folder"]` got a label | Code bug | Look up labels with `Object.hasOwn` |
| R2 | A file named `__proto__` in `src/src/` disappeared | Code bug | Tree nodes created with `Object.create(null)` |
| Old test `lists only the top level first…` | Expected `README.md` before `package.json` | Wrong test (written for the old R2) | Updated the expected order |
| R1 | `src/src/src/src/` was never shown | Code bug | `listProjectFolder` reads one folder at any depth and skips the chosen hidden names |
| R2 | File `src/src/src/src` was missing from its folder | Code bug | Same fix as R1 |
| R3 | `{ src: {} }`: after `../`, the first row was highlighted, not `src/` | Code bug | `structureHighlightAfterMove` returns the folder just left |
| R4 | `["src"]`: `../` said "Back to project root", and there was no root row at 2+ levels | Code bug | `structureNavigationRows` adds "Up to…" and, at 2+ levels, "Back to project root" |
| Old dialog test `…stops at the depth limit` | Expected `deep/` (3 levels) not to open; key presses assumed the old rows | Wrong test (written for the old 2-level limit) | Rewritten for unlimited depth and the new rows |
