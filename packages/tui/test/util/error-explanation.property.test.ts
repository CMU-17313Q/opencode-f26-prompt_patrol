import { expect, test } from "bun:test"
import type { ToolState } from "@opencode-ai/sdk/v2"
import fc from "fast-check"
import { errorExplanationPrompt, failedCommand, MAX_ERROR_OUTPUT_CHARS } from "../../src/util/error-explanation"

// P4B, mmetwaly. Codex assisted with all four properties and their generators.
// These tests exercise the real helpers, without shell execution, model calls, or mocks.
// Fixed per-property seeds make the recorded run reproducible; fast-check still
// generates and shrinks inputs. A failure reports its seed and replay path.
const time = { start: 0, end: 1 }
const nonzeroExit = fc.oneof(fc.integer({ min: -255, max: -1 }), fc.integer({ min: 1, max: 255 }))
const textUnit = fc.constantFrom("a", "Z", "0", " ", "\n", "\t", "`", "é", "λ", "🙂")
const text = fc.string({ unit: textUnit, maxLength: 80 })
const command = fc.string({ unit: textUnit, minLength: 1, maxLength: 120 })
const errorType = fc.constantFrom("ZeroDivisionError", "NameError", "TypeError", "SyntaxError")
const filename = fc.string({
  unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"),
  minLength: 1,
  maxLength: 24,
})

function completed(command: string, metadata: Record<string, unknown>): ToolState {
  return { status: "completed", input: { command }, metadata, output: "", title: command, time }
}

function request(state: ToolState) {
  const failure = failedCommand(state)
  expect(failure).toBeDefined()
  if (!failure) throw new Error("Generated eligible execution was rejected")
  return errorExplanationPrompt(failure)
}

// Read only the generated explanation, not surrounding conversation history.
// Use the expected command's length so embedded backticks/newlines in generated
// commands cannot confuse a delimiter-based parser. A wrong command still fails.
function sections(prompt: string, expectedCommand: string) {
  const marker = "Command:\n```sh\n"
  const start = prompt.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = start + marker.length + expectedCommand.length
  expect(prompt.slice(start + marker.length, end)).toBe(expectedCommand)
  expect(prompt.slice(end, end + 5)).toBe("\n```\n")
  const outputMarker = "\nError output:\n```\n"
  const outputStart = prompt.indexOf(outputMarker, end + 5)
  expect(outputStart).toBeGreaterThanOrEqual(end + 5)
  expect(prompt.endsWith("\n```")).toBe(true)
  return {
    header: prompt.slice(end + 5, outputStart),
    output: prompt.slice(outputStart + outputMarker.length, -4),
  }
}

// R2: "The explanation button should stay hidden when a command succeeds or is
// still running." Kind: invariant.
// Generate empty/nonempty commands and arbitrary output, including misleading
// error text and ANSI escapes. Every trial checks pending, running (even with a
// nonzero exit in partial metadata), and completed exit-0 states. Undefined is
// the false eligibility value used by Shell's Show when={failure()} guard.
// This does NOT render the button or verify reactive wiring, parent-session /
// showDetails gates, or click/submission behavior.
test("R2 invariant: successful and unfinished executions are ineligible", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 200 }), fc.string({ maxLength: 500 }), nonzeroExit, (cmd, output, exit) => {
      expect(failedCommand({ status: "pending", input: { command: cmd }, raw: output })).toBeUndefined()
      expect(
        failedCommand({
          status: "running",
          input: { command: cmd },
          metadata: { output: `\u001b[31mError: ${output}\u001b[0m`, exit },
          time: { start: 0 },
        }),
      ).toBeUndefined()
      expect(failedCommand(completed(cmd, { exit: 0, output }))).toBeUndefined()
      expect(failedCommand(completed(cmd, { exit: 0, output: `\u001b[31mError: ${output}\u001b[0m` }))).toBeUndefined()
    }),
    { numRuns: 500, seed: 1731302 },
  )
})

// R3 (revised): include the selected command, numeric exit when available, and
// retained output; normalize captured metadata, fall back to state.error for
// tool errors, retain at most the last 4,000 UTF-16 code units plus an ellipsis,
// use (no output) for empty output, and preserve retained file/line information.
// Kind: invariant. R5 redaction is explicitly outside this formatting property.
// Generator: nonsensitive diagnostic text includes Unicode (including surrogate
// pairs), whitespace and backticks; file names and line numbers vary. Each trial
// exercises EXACT lengths 0, 1, 3,999, 4,000, 4,001 and a generated longer length,
// not merely a random chance of reaching the boundary. ANSI/outer whitespace are
// added to known clean text, so the oracle does not call stripAnsi itself.
// Capture-present, empty, whitespace-only, nonstring, and missing metadata cases
// cover capture precedence and raw fallback (including unstripped fallback ANSI).
test("R3 invariant: request fields and retained output obey the 4000-unit contract", () => {
  expect(MAX_ERROR_OUTPUT_CHARS).toBe(4000)
  fc.assert(
    fc.property(
      command,
      text,
      filename,
      fc.integer({ min: 1, max: 9999 }),
      nonzeroExit,
      fc.integer({ min: 4002, max: 12000 }),
      (cmd, body, file, line, exit, longLength) => {
        const location = `/tmp/${file}.py:${line}:7`
        const chunk = `X${body}🙂Z`
        for (const length of [0, 1, 3999, 4000, 4001, longLength]) {
          // End sentinels prevent trim from changing the intended boundary length.
          const diagnostic =
            length < location.length + 2
              ? "X".repeat(length)
              : `X${chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length - location.length - 2)}\n${location}`
          expect(diagnostic.length).toBe(length)
          const decorated = ` \t\u001b[31m${diagnostic}\u001b[0m\r\n`
          const fallback = length === 0 ? "" : ` \u001b[33m${diagnostic}\u001b[0m `
          const captures = [
            { state: completed(cmd, { exit, output: decorated }), expected: diagnostic, exit },
            ...[exit, 0, undefined].map((code) => ({
              state: {
                status: "error" as const,
                input: { command: cmd },
                time,
                error: fallback,
                metadata: { exit: code, output: decorated },
              },
              expected: diagnostic || fallback,
              exit: code,
            })),
            ...[undefined, {}, { output: "" }, { output: " \t\u001b[31m\u001b[0m\n" }, { output: 42 }].map(
              (metadata) => ({
                state: { status: "error" as const, input: { command: cmd }, time, error: fallback, metadata },
                expected: fallback,
                exit: undefined,
              }),
            ),
          ]
          for (const capture of captures) {
            const failure = failedCommand(capture.state)
            expect(failure).toEqual({ command: cmd, exit: capture.exit, output: capture.expected })
            const parsed = sections(request(capture.state), cmd)
            expect(parsed.header).toBe(capture.exit === undefined ? "" : `Exit code: ${capture.exit}\n`)
            if (capture.expected.length === 0) {
              expect(parsed.output).toBe("(no output)")
            } else if (capture.expected.length <= 4000) {
              expect(parsed.output).toBe(capture.expected)
            } else {
              // Length + suffix equality specifies tail retention without copying
              // the implementation's slice(-MAX_ERROR_OUTPUT_CHARS) expression.
              expect(parsed.output.length).toBe(4001)
              expect(parsed.output[0]).toBe("…")
              expect(capture.expected.endsWith(parsed.output.substring(1))).toBe(true)
            }
            if (diagnostic.includes(location)) expect(parsed.output).toContain(location)
          }
        }
      },
    ),
    { numRuns: 250, seed: 1731303 },
  )
})

// R6 (revised): preserve the selected execution's file location and error type
// when they exist in retained output; another run must not substitute its file.
// Kind: metamorphic. Generate TWO independent failed states with the same command,
// exit, and error type. Distinct A-/B- prefixes make filenames non-overlapping.
// Noise spans both sides of 4,000; the generated location/type stay at the tail.
// Change only the filename between the executions, generate each request, and
// repeat in reverse order. This tests helper data isolation, not UI selection.
test("R6 metamorphic: separate executions retain their own filenames", () => {
  fc.assert(
    fc.property(
      filename,
      errorType,
      nonzeroExit,
      fc.integer({ min: 1, max: 9999 }),
      fc.integer({ min: 0, max: 8000 }),
      (name, type, exit, line, noiseLength) => {
        const fileA = `/tmp/A-${name}.py`
        const fileB = `/tmp/B-${name}.py`
        const outputA = `${"x".repeat(noiseLength)}\n${type}: failure at ${fileA}:${line}:1`
        const outputB = `${"x".repeat(noiseLength)}\n${type}: failure at ${fileB}:${line}:1`
        const stateA = completed("python3 runner.py", { exit, output: outputA })
        const stateB = completed("python3 runner.py", { exit, output: outputB })
        const firstA = request(stateA)
        const firstB = request(stateB)
        const reverseB = request(stateB)
        const reverseA = request(stateA)
        expect(reverseA).toBe(firstA)
        expect(reverseB).toBe(firstB)
        const a = sections(firstA, "python3 runner.py")
        const b = sections(firstB, "python3 runner.py")
        expect(firstA).toContain(fileA)
        expect(firstB).toContain(fileB)
        expect(a.output).not.toContain(fileB)
        expect(b.output).not.toContain(fileA)
        expect(a.output).toContain(`${type}: failure at ${fileA}:${line}:1`)
        expect(b.output).toContain(`${type}: failure at ${fileB}:${line}:1`)
        expect(a.header).toBe(b.header)
        expect(a.output.replace(fileA, fileB)).toBe(b.output)
      },
    ),
    { numRuns: 500, seed: 1731306 },
  )
})

// R7: "If the command changes but produces the same error type, the AI request
// should include the updated command." Kind: metamorphic.
// Generate arbitrary nonempty command text and a nonempty appended argument to
// guarantee different commands without filtering/shrink rejection. Both separate
// executions use identical generated error text/type and exit. Logs range from
// short to truncated; Unicode/backticks exercise verbatim command preservation.
test("R7 metamorphic: changing the command updates only its request section", () => {
  fc.assert(
    fc.property(
      command,
      command,
      text,
      errorType,
      nonzeroExit,
      fc.integer({ min: 0, max: 8000 }),
      (cmd, argument, detail, type, exit, noiseLength) => {
        const updated = `${cmd} ${argument}`
        const output = `${"x".repeat(noiseLength)}\n${type}: ${detail}`
        const originalRequest = request(completed(cmd, { exit, output }))
        const updatedRequest = request(completed(updated, { exit, output }))
        const original = sections(originalRequest, cmd)
        const changed = sections(updatedRequest, updated)
        expect(updatedRequest).not.toBe(originalRequest)
        expect(changed.output).toBe(original.output)
        expect(changed.output).toContain(type)
        expect(changed.header).toBe(original.header)
        // A later request must not replace the command in an older execution.
        expect(request(completed(cmd, { exit, output }))).toBe(originalRequest)
      },
    ),
    { numRuns: 500, seed: 1731307 },
  )
})
