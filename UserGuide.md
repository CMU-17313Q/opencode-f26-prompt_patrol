# Prompt Patrol User Guide

This guide covers the features the Prompt Patrol team added to OpenCode: how to use each one, how to test it by hand, and where its automated tests are.

## Error output capture

OpenCode preserves useful error output when a command fails. This allows later features to inspect the actual runtime or compiler error instead of losing the failure information.

### How to test it manually

Start OpenCode from the repository root and ask the agent to run commands that intentionally fail.

For a JavaScript runtime error, ask it to run:

```sh
bun -e 'function explode() { throw new Error("prompt patrol runtime error") } explode()'
```

The failed command output should still include the runtime error and its stack trace instead of losing the error information.

For a TypeScript compiler error, ask it to run:

```sh
echo 'const value: number = "wrong"' > broken.ts && bunx tsc --noEmit broken.ts
```

The command creates a temporary `broken.ts` file in the current project directory and compiles it. The failed command output should include the TypeScript diagnostic, such as `TS2322`, the file name `broken.ts`, and a non-zero exit code.

After testing, remove the temporary file:

```sh
rm broken.ts
```

### Automated tests

The automated tests are in:

[`packages/core/test/tool-bash.test.ts`](packages/core/test/tool-bash.test.ts)

Run them with:

```sh
cd packages/core
bun test test/tool-bash.test.ts
```

The relevant tests are:

- `captures JavaScript runtime error output from a failed command`
- `captures TypeScript compiler error output from a failed command`

The JavaScript test runs a real failing program and verifies that the error message, stack information, source file, and failed exit code are preserved.

The TypeScript test runs the real TypeScript compiler on invalid code and verifies that the compiler diagnostic, source file, and failed exit code are preserved.

Together, these tests cover the acceptance criteria for issue #7 by verifying a runtime stack trace and a compiler error from two supported languages.

## Explain an error from the terminal

When a command fails in an OpenCode session, an **Explain this to me** button appears under the error output. Selecting it sends the error to the agent, which replies in plain language with what went wrong, which file and line it points to, and how to fix it. The explanation feature planned in #9 isn't built yet, so the agent does the explaining for now.

A command counts as failed when it exits with a non-zero code, or when the shell tool reports an error after the command started. Commands that succeed don't get the button. Neither do commands that never ran because permission was denied, or commands you stop yourself, since they didn't fail.

### How to use it

1. Start OpenCode from the repository root, pointing it at the project folder you want to work in: `bun dev ~/my-project`. An installed `opencode` won't have this feature.
2. Connect a model. OpenCode's built-in free models only accept requests from official releases, so a local build needs its own: type `/connect`, choose OpenRouter, paste your team's key, then pick a model ending in `:free` with `/models`.
3. Trigger a failing command in one of two ways:
   - Ask the agent to run something that fails, e.g. `run bun -e "throw new TypeError('boom')"`.
   - Switch the prompt to shell mode by typing `!` at the start of an empty prompt, then enter a failing command such as `bun -e "throw new TypeError('boom')"`.
4. The command's output shows in a block with a red **Explain this to me** button under it.
5. Click the button. The prompt fills with a request containing the command, its exit code, and its error output, then submits it. The agent's explanation appears as the next message.

Very long output is trimmed to its last 4,000 characters, since that is where the error message usually is. Terminal color codes are removed before the output is sent.

### How to test it manually

| Scenario                                                         | Expected result                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `!bun -e "throw new TypeError('boom')"`                          | Button shown. Clicking it sends a prompt containing `TypeError: boom` and `Exit code: 1`. |
| `!echo "const x: number = 'a'" > b.ts && bunx tsc --noEmit b.ts` | Button shown. The prompt includes the `TS2322` diagnostic and `b.ts(1,7)`.                |
| `!ls`                                                            | No button (exit code 0).                                                                  |
| `!sleep 30`, then press Esc twice to stop it                     | No button (you stopped it, so it didn't fail).                                            |
| Ask the agent to run a command, then deny the permission request | No button (the command never ran).                                                        |
| Open a subagent session with a failed command                    | No button (subagent views have no prompt to send to).                                     |
| Long-running failing build (e.g. thousands of lines of output)   | Button shown. The prompt contains the end of the output, starting with `…`.               |

### Automated tests

Tests:

- [`packages/tui/test/util/error-explanation.test.ts`](packages/tui/test/util/error-explanation.test.ts): when the button appears and what it sends
- [`packages/opencode/test/session/prompt.test.ts`](packages/opencode/test/session/prompt.test.ts): the tests named `shell records the exit code of a failed command` and `shell records a zero exit code for a successful command`

Run them from each package:

```sh
cd packages/tui && bun test test/util/error-explanation.test.ts
cd packages/opencode && bun test test/session/prompt.test.ts -t "exit code"
```

Commands the agent runs already recorded their exit code. Commands you run yourself with `!` did not, so OpenCode couldn't tell that they failed. This feature adds the exit code to those commands too ([`packages/opencode/src/session/prompt.ts`](packages/opencode/src/session/prompt.ts)). The two `prompt.test.ts` tests run real commands and check that a failing one records its non-zero exit code and a passing one records `0`. Both tests fail without the change.

The button is driven by two functions in [`packages/tui/src/util/error-explanation.ts`](packages/tui/src/util/error-explanation.ts). The TUI uses their results directly: the button renders only when `failedCommand` returns a value, and clicking it submits exactly what `errorExplanationPrompt` returns. The tests cover both functions:

- **`failedCommand`** decides whether a shell tool call should show the button. The tests check that it:
  - detects a JavaScript runtime error (exit 1) and a TypeScript compiler error (exit 2), the two error shapes the team's error-capture work targets
  - strips ANSI color codes so the explanation request gets clean text
  - does not flag successful commands, commands with no exit code, unfinished commands, commands the user stopped, or calls with no command
  - treats a tool-level error as a failure, keeping the captured output, or falling back to the error message when no output was captured
- **`errorExplanationPrompt`** builds what gets sent to the explanation feature. The tests check that it:
  - includes the command, exit code, and full error output in a fixed format
  - leaves out the exit code line when the code is unknown
  - marks empty output explicitly
  - keeps the end of very long output, where the error is, within the size limit

Together these cover every branch of the logic that decides when the button appears and what it sends, for both agent-run and `!` commands. The UI wiring in `packages/tui/src/routes/session/index.tsx` is a small amount of rendering code that calls these two functions. It is checked by the manual scenarios above and by `bun typecheck`.

## Fix confidence level

When the agent suggests a fix for a failed command, `computeFixConfidence` rates how much to trust it as **high**, **medium** or **low**, and lists the reasons for that rating. It does not look at whether the fix is correct, only at signs that make a fix more or less likely to be: how big it is, whether it was verified, whether the explanation hedges, and whether it changes the file where the error was reported.

The code is in [`packages/script/src/fix-confidence.ts`](packages/script/src/fix-confidence.ts). It takes `{ diff, explanation, verificationPassed?, errorOutput? }` and returns `{ level, reasons }`. Every input gets at least one reason, so the rating always explains itself.

Each signal adds or subtracts points, and the total picks the level (3 or more is high, 0 to 2 is medium, below 0 is low):

| Signal                                                                    | Points                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Diff size                                                                 | up to 10 changed lines +1, 11 to 50 is 0, more than 50 is -1, an empty diff is -1                  |
| Files changed                                                             | 1 file +1, 2 to 3 files 0, more than 3 files -1                                                    |
| Verification (tests, typecheck, rerun)                                    | passed +2, failed -2, not run -1                                                                   |
| Hedging in the explanation ("might", "possibly", "try this", and similar) | -1 for each hedging phrase                                                                         |
| Error location, from `parseErrorLocation`                                 | fix changes the reported file +2, changes other files -2, unparseable output -1, no error output 0 |

The point values and cutoffs are the team's own choices, since the issue didn't define them.

The function is not connected to the UI yet. It is a building block for showing a confidence rating next to a suggested fix.

### How to use it

Run it from the repository root on a fix of your own:

```sh
bun -e 'import { computeFixConfidence } from "./packages/script/src/fix-confidence.ts"; console.log(computeFixConfidence({ diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new", explanation: "The variable was typed as number but assigned a string.", verificationPassed: true, errorOutput: "src/app.ts(3,5): error TS2322: Type string is not assignable to type number." }))'
```

### How to test it manually

Change one input at a time in the command above and check the result:

| Change                                                                    | Expected result                                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| None (the command as written)                                             | `high`, with a reason saying it changes `src/app.ts`, where the TS2322 was reported                  |
| Set `verificationPassed` to `false`                                       | `medium`, with the reason `Verification failed after the fix`                                        |
| Remove `verificationPassed`                                               | Still `high` (it drops to exactly 3 points), with the reason `The fix was not verified`              |
| Change the explanation to `This might work, you could possibly try this.` | Still `high` (it drops to exactly 3 points), with a reason naming "might", "possibly" and "try this" |
| Do both of the two changes above                                          | `medium`, with both reasons                                                                          |
| Change `src/app.ts` in the diff to `src/other.ts`                         | `medium`, with the reason `Does not change src/app.ts, where the TS2322 was reported`                |
| Remove `errorOutput`                                                      | Still `high`, with the reason `No error output was provided`                                         |
| Set `diff` and `explanation` to empty strings                             | `low`, with at least one reason                                                                      |

### Automated tests

Tests: [`packages/script/test/fix-confidence.test.ts`](packages/script/test/fix-confidence.test.ts)

```sh
cd packages/script && bun test test/fix-confidence.test.ts
```

The 9 tests check:

- a small, verified fix on the reported file is high, and its reason names the error type
- a large, unverified, hedging fix in other files is low, with reasons for the hedging and for not being verified
- a fix whose verification failed is medium, with the failed-verification reason
- a result is still returned when there is no error output
- error output that cannot be parsed is flagged in the reasons
- empty input still returns at least one reason and a low level
- an absolute error path in the output matches a relative path in the diff
- the diff-size signal is reported for a moderate-size diff
- the changed-file-count signal is reported when a fix changes multiple files

Running the tests with `--coverage` shows 100% of lines and functions in `fix-confidence.ts` covered. The tests check the level for the high, medium and low cases and that the expected reasons appear, but they don't pin every point value, so small tuning changes may not fail a test. They also run in CI as part of the `@opencode-ai/script` test task.
Together, the automated tests and the three-scenario demo cover the acceptance criteria for issue #21.

## Project structure scanner

The scanner reads a project folder and gives you two things: a file and folder tree, and short purpose guesses for the top-level folders and files, like `src/ - main application code` or `package.json - Node.js package manifest and dependencies`. It only guesses for names it recognizes. A folder called `weird-folder-name/` still shows up in the tree but gets no guess, so it never guesses wrong.

It skips folders that are noise for understanding a project: `node_modules`, `.git`, `dist`, `build`, `out`, `.turbo`, `.cache` and `coverage`.

The code is in [`packages/script/src/project-structure.ts`](packages/script/src/project-structure.ts). `summarizeProjectStructure(root)` returns the tree and the guesses.

### How to use it

In an OpenCode TUI session, press `Ctrl+P`, choose **Suggested**, then select **View project structure**. The read-only dialog shows recognized purpose guesses under **Overview** and the complete project tree under **Project files**. Selecting a row does not open it.

You can also run it on any folder from the repository root:

```sh
bun -e 'import { summarizeProjectStructure } from "./packages/script/src/project-structure.ts"; const s = await summarizeProjectStructure(process.argv[1]); console.log(s.purposeGuesses.join("\n") + "\n\n" + s.tree)' path/to/project
```

### How to test it manually

To manually check the TUI feature, open a session, press `Ctrl+P`, and select **Suggested → View project structure**. Confirm the overview and tree appear, then try selecting a row and confirm the view stays open without navigating.

To manually check the scanner output, run it on folders with different layouts and check the output:

| Folder                                                               | Expected result                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| This repository (`.`)                                                | `packages/ - monorepo packages`, `script/ - developer/build scripts`, `.github/ - GitHub Actions…` |
| A small app with `src/`, `test/` and `node_modules/`                 | Guesses for `src/` and `test/`. `node_modules` doesn't appear anywhere.                            |
| A project containing a folder with an unusual name, like `my-stuff/` | `my-stuff/` appears in the tree with no purpose guess.                                             |

### Automated tests

Tests: [`packages/script/test/project-structure.test.ts`](packages/script/test/project-structure.test.ts)

```sh
cd packages/script && bun test test/project-structure.test.ts
```

The issue's acceptance criteria ask for a correct tree and purpose guesses, checked against 3 sample repos with different structures. The tests build those 3 repos in temporary folders and check the exact output:

- a typical JS/TS app (`src/`, `test/`, `docs/`, `package.json`, plus `node_modules/` that must be left out)
- a monorepo like this one (`apps/`, `packages/`, `scripts/`, `.github/`)
- a small library with `lib/`, `README.md`, `LICENSE` and an unrecognized folder that must get no guess

Two more tests check that files come back sorted with build output and `node_modules` left out, and that `scanProjectStructure` returns the file list the component relationship mapper (#14) uses.

Running the tests with `--coverage` shows 100% of lines and functions in `project-structure.ts` covered, so every line of the scanner runs in at least one test. These tests also run in CI as part of the `@opencode-ai/script` test task.

## Error type and file location parser

When a command fails, the error output is a block of text. The parser reads that text and pulls out two things: the **error type** (for example `TypeError` or the TypeScript diagnostic `TS2322`) and **where it came from** (file, line and column). It handles JavaScript and TypeScript, the two languages the team's error capture targets. If the output doesn't match a known error shape, it returns nothing instead of guessing.

The code is in [`packages/script/src/error-location.ts`](packages/script/src/error-location.ts). `parseErrorLocation(output)` returns `{ language, type, file?, line?, column? }`, or `undefined`.

- For JavaScript, the type is the first `SomethingError:` line, and the location is the first stack frame (`at ... file:line:column`) in that error's own block, so a type is never paired with a later error's location. A `SyntaxError` with no stack frame still returns its type, with no file or line.
- For TypeScript, the type is the diagnostic code and the location comes from `file.ts(line,column)`. If `tsc` reports several errors, the first one is used.

The parser is not connected to the UI yet. It is a building block for the explanation features, which will use the type and location to say what went wrong and where.

### How to use it

Run it on any error text from the repository root:

```sh
bun -e 'import { parseErrorLocation } from "./packages/script/src/error-location.ts"; console.log(parseErrorLocation(process.argv[1]))' "TypeError: boom
    at file:///tmp/broken.js:3:7"
```

### How to test it manually

| Input                                                                             | Expected result                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `TypeError: boom` followed by `at file:///tmp/broken.js:3:7`                      | `javascript`, type `TypeError`, file `/tmp/broken.js`, line 3, column 7 |
| `broken.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` | `typescript`, type `TS2322`, file `broken.ts`, line 1, column 7         |
| `SyntaxError: Unexpected token` with no stack frame                               | `javascript`, type `SyntaxError`, no file or line                       |
| Two `tsc` errors in one output                                                    | Only the first error is returned                                        |
| `all good, nothing failed`                                                        | `undefined`                                                             |

To try it on a real failure, run `bun -e "throw new TypeError('boom')"`, copy its output, and pass it to `parseErrorLocation`.

### Automated tests

Tests: [`packages/script/test/error-location.test.ts`](packages/script/test/error-location.test.ts)

```sh
cd packages/script && bun test test/error-location.test.ts
```

The tests use realistic error output and check the exact result:

- **JavaScript (7 tests):** `TypeError`, `ReferenceError`, `SyntaxError` with no stack frame, `RangeError`, a plain `Error` from an `.mjs` file, an error in a `.ts` file, and a check that an error is not paired with a later error's location.
- **TypeScript (5 tests):** `TS2322`, `TS2339`, `TS2304`, `TS2554` in a `.tsx` file, and several diagnostics where only the first is used.
- **No match (1 test):** output with no recognized error shape returns `undefined`.

Running the tests with `--coverage` shows 100% of lines and functions in `error-location.ts` covered, so every line of the parser runs in at least one test. They also run in CI as part of the `@opencode-ai/script` test task.
