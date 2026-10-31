import type { ToolState } from "@opencode-ai/sdk/v2"
import stripAnsi from "strip-ansi"

// Long build logs would crowd the prompt; the actual error is almost always at the end.
export const MAX_ERROR_OUTPUT_CHARS = 4000

export type FailedCommand = {
  command: string
  exit?: number
  output: string
}

/**
 * Returns the failed command captured by a shell tool call, or `undefined` when the
 * call is still running, succeeded, or was stopped by the user. A call counts as failed
 * when the command exits with a non-zero code or the tool itself reports an error.
 */
export function failedCommand(state: ToolState): FailedCommand | undefined {
  if (state.status === "pending" || state.status === "running") return
  const command = typeof state.input.command === "string" ? state.input.command : undefined
  if (!command) return
  const metadata = state.metadata ?? {}
  // A command the user stopped didn't fail, so there's nothing to explain.
  if (metadata.interrupted === true) return
  const exit = typeof metadata.exit === "number" ? metadata.exit : undefined
  const captured = typeof metadata.output === "string" ? stripAnsi(metadata.output).trim() : ""
  if (state.status === "error") return { command, exit, output: captured || state.error }
  if (exit === undefined || exit === 0) return
  return { command, exit, output: captured }
}

/** Builds the request handed to the error explanation feature for a failed command. */
export function errorExplanationPrompt(failure: FailedCommand) {
  const output =
    failure.output.length > MAX_ERROR_OUTPUT_CHARS
      ? `…${failure.output.slice(-MAX_ERROR_OUTPUT_CHARS)}`
      : failure.output
  return [
    "Explain this error to me in plain language.",
    "Tell me what went wrong, which file and line it points to (if any), and how I could fix it.",
    "",
    "Command:",
    "```sh",
    failure.command,
    "```",
    ...(failure.exit === undefined ? [] : [`Exit code: ${failure.exit}`]),
    "",
    "Error output:",
    "```",
    output || "(no output)",
    "```",
  ].join("\n")
}
