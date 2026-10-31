import { parseErrorLocation } from "./error-location"

export type SuggestedFix = {
  /** Unified diff of the proposed change. */
  diff: string
  /** The model's explanation of the fix. */
  explanation: string
  /** Whether verification (tests, typecheck, rerun) passed after applying the fix. Omit if not run. */
  verificationPassed?: boolean
  /** Captured error output the fix is meant to resolve. Omit if there was none. */
  errorOutput?: string
}

export type FixConfidence = {
  level: "high" | "medium" | "low"
  reasons: string[]
}

const hedgingPattern = /\b(might|maybe|possibly|perhaps|could be|try this|try (?:to )?(?:run|using|changing)|not sure|i think|probably)\b/gi

/**
 * Scores how much to trust a suggested fix. Each signal adds or subtracts points and
 * contributes a human-readable reason, so the result always explains itself.
 */
export function computeFixConfidence(fix: SuggestedFix): FixConfidence {
  const files = changedFiles(fix.diff)
  const changedLines = fix.diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line)).length
  const hedges = fix.explanation.match(hedgingPattern) ?? []
  const signals = [
    diffSize(changedLines),
    fileCount(files.length),
    verification(fix.verificationPassed),
    hedging(hedges),
    errorMatch(fix.errorOutput, files),
  ]
  const score = signals.reduce((total, signal) => total + signal.points, 0)
  return {
    level: score >= 3 ? "high" : score >= 0 ? "medium" : "low",
    reasons: signals.map((signal) => signal.reason),
  }
}

type Signal = { points: number; reason: string }

function changedFiles(diff: string) {
  const files = diff.split("\n").flatMap((line) => {
    const match = line.match(/^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/) ?? line.match(/^diff --git a\/.+ b\/(.+)$/)
    return match && match[1] !== "/dev/null" ? [match[1]] : []
  })
  return [...new Set(files)]
}

function diffSize(lines: number): Signal {
  if (lines === 0) return { points: -1, reason: "The diff contains no changed lines" }
  if (lines <= 10) return { points: 1, reason: `Small diff (${lines} changed lines)` }
  if (lines <= 50) return { points: 0, reason: `Moderate diff (${lines} changed lines)` }
  return { points: -1, reason: `Large diff (${lines} changed lines)` }
}

function fileCount(count: number): Signal {
  if (count <= 1) return { points: 1, reason: count === 1 ? "Changes a single file" : "No changed files found in the diff" }
  if (count <= 3) return { points: 0, reason: `Changes ${count} files` }
  return { points: -1, reason: `Changes many files (${count})` }
}

function verification(passed: boolean | undefined): Signal {
  if (passed === true) return { points: 2, reason: "Verification passed after the fix" }
  if (passed === false) return { points: -2, reason: "Verification failed after the fix" }
  return { points: -1, reason: "The fix was not verified" }
}

function hedging(hedges: string[]): Signal {
  if (hedges.length === 0) return { points: 0, reason: "The explanation does not hedge" }
  const words = [...new Set(hedges.map((hedge) => hedge.toLowerCase()))].map((word) => `"${word}"`).join(", ")
  return { points: -hedges.length, reason: `The explanation hedges (${words})` }
}

function errorMatch(output: string | undefined, files: string[]): Signal {
  if (!output?.trim()) return { points: 0, reason: "No error output was provided" }
  const error = parseErrorLocation(output)
  if (!error) return { points: -1, reason: "Could not determine the error type or location from the output" }
  if (!error.file) return { points: 0, reason: `Parsed ${error.type} but it has no file location` }
  const errorFile = error.file
  const touched = files.some((file) => errorFile === file || errorFile.endsWith(`/${file}`) || file.endsWith(`/${errorFile}`))
  return touched
    ? { points: 2, reason: `Changes ${errorFile}, where the ${error.type} was reported` }
    : { points: -2, reason: `Does not change ${errorFile}, where the ${error.type} was reported` }
}
