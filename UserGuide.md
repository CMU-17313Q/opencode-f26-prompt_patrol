# Prompt Patrol User Guide

This guide covers the features the Prompt Patrol team added to OpenCode: how to use each one, how to test it by hand, and where its automated tests are.

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

## Fix confidence levels

Prompt Patrol can estimate how trustworthy a suggested fix is using several signals, including the size of the diff, number of changed files, verification results, hedging in the explanation, and whether the fix changes the file where the error was reported.

The result is classified as **high**, **medium**, or **low** confidence, with the reasons for that level listed underneath.

### How to test it manually

Run the demo from the repository root:

```sh
cd packages/script
bun demo/fix-confidence-demo.ts
```

The demo shows three scenarios:

- **HIGH** confidence in green
- **MEDIUM** confidence in yellow
- **LOW** confidence in red

Each scenario lists the reasons used to calculate the confidence level.

The low-confidence scenario also displays:

```text
⚠ Double-check this fix before applying
```

Check that all three levels and their reasons make sense for the supplied scenarios.

### Automated tests

The automated tests are in:

[`packages/script/test/fix-confidence.test.ts`](packages/script/test/fix-confidence.test.ts)

Run them with:

```sh
cd packages/script
bun test test/fix-confidence.test.ts
```

The tests cover high, medium, and low confidence results, a case with no error output, and the signals used by the confidence calculation: diff size, changed-file count, verification status, hedging, and error-file matching.

Together, the automated tests and the three-scenario demo cover the acceptance criteria for issue #21.

## Project structure scanner

The scanner reads a project folder and gives you two things: a file and folder tree, and short purpose guesses for the top-level folders and files, like `src/ - main application code` or `package.json - Node.js package manifest and dependencies`. It only guesses for names it recognizes. A folder called `weird-folder-name/` still shows up in the tree but gets no guess, so it never guesses wrong.

It skips folders that are noise for understanding a project: `node_modules`, `.git`, `dist`, `build`, `out`, `.turbo`, `.cache` and `coverage`.

The code is in [`packages/script/src/project-structure.ts`](packages/script/src/project-structure.ts). `summarizeProjectStructure(root)` returns the tree and the guesses.

### How to use it

In OpenCode, press `Ctrl+P` and choose **View project structure**. The dialog shows the purpose guesses under **Overview** and the tree under **Project files**. This menu option comes from #22 and needs that work merged.

You can also run it on any folder from the repository root:

```sh
bun -e 'import { summarizeProjectStructure } from "./packages/script/src/project-structure.ts"; const s = await summarizeProjectStructure(process.argv[1]); console.log(s.purposeGuesses.join("\n") + "\n\n" + s.tree)' path/to/project
```

### How to test it manually

Run it on a few folders with different layouts and check the output:

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
