# Traceability: Jana Hussien (jhussien)

**Target feature:** View project structure (`packages/script/src/project-structure.ts`, `packages/tui/src/component/dialog-project-structure.tsx`)

**Tests:** `packages/script/test/project-structure-errors.property.test.ts`

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4B? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | C-7, S-8, S-9 | Deleted files don't show up when the tree is reopened. | Add `notes.txt`: it's listed. Delete it and reopen: it's gone. | No | Adding then deleting a file gives the same listing as before (round-trip) | `R1: a file that is added and then deleted...` |
| R2 | C-10, O-7, O-12 | Names it doesn't know get no purpose. | `src/` shows a purpose; `xyz/` shows nothing. | No | Every unknown name has no purpose (invariant) | `R2: folders and files with names it doesn't know...` |
| R3 | S-6, S-13 | Purposes are labeled as guesses. | `src/` shows "likely: main application code". | No | Every purpose shown starts with "likely: " (invariant) | `R3: every purpose the viewer shows...` |
| R4 | C-8, S-11, O-10 | Changing only a folder's capitals keeps its guess. Any other rename changes only that folder's row. | `src/` → `Src/` keeps its guess. `src/` → `source/` leaves `docs/` unchanged. | Yes | Recasing keeps the purpose; renaming leaves other rows the same (metamorphic) | `R4: changing a folder's capitals...` |
| R5 | S-14, O-14, C-11 | An empty project shows a message instead of a blank list. | A project with only `node_modules/` and `.git/` shows "No project files found". | No | Only ignored folders → empty listing (invariant) | `R5: a project with only ignored folders...` |
| R6 | C-12, O-15 | If the project folder can't be found when the viewer opens, it shows "Folder not found: \<path\>", not a raw error. | Delete the project folder, then open the viewer: "Folder not found: \<path\>", no "ENOENT". | Yes | Missing folder → exactly "Folder not found: \<path\>" (invariant) | `R6: a project folder that can't be found...` |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R4, R5, R6.

## Requirement changes

| ID | Original requirement (P4A) | Revised requirement | Why it changed |
|---|---|---|---|
| R4 | Changing capitals keeps the same guess, and renaming a folder only changes that folder's row. | Changing only a folder's capitals keeps its guess. Any other rename changes only that folder's row. | Not feasible + conflict: C-8 wanted the guess kept after `src/` → `source/`, but guesses come from names only, and keeping it would break R2 (unknown names get no guess). |
| R6 | A folder that doesn't exist shows no rows and a short message, not a raw error. (Acceptance: open the tree on `/tmp/missing`.) | If the project folder can't be found when the viewer opens, it shows "Folder not found: \<path\>", not a raw error. | Not checkable as written: users can't choose a path in the viewer, but the folder can be deleted while opencode runs. |

R1, R2, R3, and R5 were kept because they can be built and checked as written.

## Failures and fixes

| Property | Counterexample | Outcome | Fix |
|---|---|---|---|
| R1 | file named `__proto__` | Code bug: file never appeared | Build trees with `Object.create(null)` |
| R2 | folder named `constructor` | Code bug: got purpose `[class Object]` | Look up purposes with `Object.hasOwn` |
| R3 | `cargo.toml` | Code bug: no "likely:" label | Added `structureEntryDescription`; dialog uses it |
| R6 | missing folder `_` | Code bug: raw `ENOENT` error shown | Scanner throws "Folder not found: \<path\>" |

R4 and R5 passed on the first run. All properties pass now.
