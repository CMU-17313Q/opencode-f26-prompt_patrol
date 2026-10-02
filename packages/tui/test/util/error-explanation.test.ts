import { describe, expect, test } from "bun:test"
import { errorExplanationPrompt, failedCommand, MAX_ERROR_OUTPUT_CHARS } from "../../src/util/error-explanation"

const time = { start: 0, end: 1 }

function completed(command: string, metadata: Record<string, unknown>) {
  return {
    status: "completed" as const,
    input: { command },
    output: "",
    title: command,
    metadata,
    time,
  }
}

describe("failedCommand", () => {
  test("detects a JavaScript runtime error with a non-zero exit code", () => {
    const output = "1 | throw new TypeError('boom')\nTypeError: boom\n    at /tmp/app.js:1:7"
    expect(failedCommand(completed("bun app.js", { exit: 1, output }))).toEqual({
      command: "bun app.js",
      exit: 1,
      output,
    })
  })

  test("detects a TypeScript compiler error", () => {
    const output = "broken.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'."
    expect(failedCommand(completed("tsc --noEmit broken.ts", { exit: 2, output }))).toEqual({
      command: "tsc --noEmit broken.ts",
      exit: 2,
      output,
    })
  })

  test("strips terminal color codes from the captured output", () => {
    expect(
      failedCommand(completed("bun test", { exit: 1, output: "\u001b[31merror: failed\u001b[39m\n" }))?.output,
    ).toBe("error: failed")
  })

  test("ignores commands that succeeded", () => {
    expect(failedCommand(completed("ls", { exit: 0, output: "README.md" }))).toBeUndefined()
  })

  test("ignores commands without a known exit code", () => {
    expect(failedCommand(completed("sleep 100", { exit: null, output: "" }))).toBeUndefined()
  })

  test("ignores commands that have not finished", () => {
    expect(failedCommand({ status: "running", input: { command: "bun app.js" }, time })).toBeUndefined()
    expect(failedCommand({ status: "pending", input: { command: "bun app.js" }, raw: "" })).toBeUndefined()
  })

  test("ignores tool calls without a command", () => {
    expect(failedCommand(completed("", { exit: 1, output: "error" }))).toBeUndefined()
  })

  test("treats a tool error as a failure and keeps the captured output", () => {
    expect(
      failedCommand({
        status: "error",
        input: { command: "bun app.js" },
        error: "Tool execution failed",
        metadata: { output: "ReferenceError: x is not defined" },
        time,
      }),
    ).toEqual({ command: "bun app.js", exit: undefined, output: "ReferenceError: x is not defined" })
  })

  test("ignores commands the user stopped", () => {
    expect(
      failedCommand({
        status: "error",
        input: { command: "sleep 30" },
        error: "Tool execution aborted",
        metadata: { output: "", interrupted: true },
        time,
      }),
    ).toBeUndefined()
  })

  test("falls back to the tool error message when nothing was captured", () => {
    expect(
      failedCommand({ status: "error", input: { command: "bun app.js" }, error: "Unable to execute command", time })
        ?.output,
    ).toBe("Unable to execute command")
  })
})

describe("errorExplanationPrompt", () => {
  test("includes the command, exit code, and error output", () => {
    expect(
      errorExplanationPrompt({ command: "bun app.js", exit: 1, output: "TypeError: boom\n    at /tmp/app.js:1:7" }),
    ).toBe(
      [
        "Explain this error to me in plain language.",
        "Tell me what went wrong, which file and line it points to (if any), and how I could fix it.",
        "",
        "Command:",
        "```sh",
        "bun app.js",
        "```",
        "Exit code: 1",
        "",
        "Error output:",
        "```",
        "TypeError: boom",
        "    at /tmp/app.js:1:7",
        "```",
      ].join("\n"),
    )
  })

  test("omits the exit code line when the exit code is unknown", () => {
    expect(errorExplanationPrompt({ command: "bun app.js", output: "aborted" })).not.toContain("Exit code")
  })

  test("marks empty output explicitly", () => {
    expect(errorExplanationPrompt({ command: "false", exit: 1, output: "" })).toContain("```\n(no output)\n```")
  })

  test("keeps only the end of very long output, where the error usually is", () => {
    const prompt = errorExplanationPrompt({
      command: "bun run build",
      exit: 1,
      output: "noise\n".repeat(2000) + "SyntaxError: Unexpected token",
    })
    expect(prompt).toContain("SyntaxError: Unexpected token")
    expect(prompt).toContain("…")
    expect(prompt.split("Error output:\n```\n")[1].length).toBeLessThanOrEqual(MAX_ERROR_OUTPUT_CHARS + 5)
  })
})
