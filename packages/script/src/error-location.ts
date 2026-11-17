/**
 * Parses captured command error output (as produced by the bash tool, see
 * packages/core/src/tool/bash.ts) and identifies the error type plus the
 * file/line it originates from.
 *
 * Currently covers JavaScript and TypeScript, matching the error output the
 * bash tool captures today. Adding a language means adding one entry to
 * `languageParsers` below; the return shape stays the same.
 */

export type ParsedError = {
  language: "javascript" | "typescript"
  /** e.g. "TypeError", "SyntaxError", or a TypeScript diagnostic code like "TS2322". */
  type: string
  file?: string
  line?: number
  column?: number
}

/**
 * Scans captured error output and returns the error type and file/line it
 * originates from, or `undefined` if no known language's error shape matches.
 * When output contains multiple errors, the first one found wins.
 */
export function parseErrorLocation(output: string): ParsedError | undefined {
  for (const parser of languageParsers) {
    const parsed = parser(output)
    if (parsed) return parsed
  }
  return undefined
}

const languageParsers: Array<(output: string) => ParsedError | undefined> = [parseTypeScriptError, parseJavaScriptError]

/**
 * tsc diagnostics look like:
 *   broken.ts(1,20): error TS2322: Type 'string' is not assignable to type 'number'.
 */
function parseTypeScriptError(output: string): ParsedError | undefined {
  const match = output.match(/([^\s():]+\.tsx?)\((\d+),(\d+)\):\s*error\s+(TS\d+):/)
  if (!match) return undefined
  const [, file, line, column, code] = match
  return { language: "typescript", type: code, file, line: Number(line), column: Number(column) }
}

/**
 * Node/Bun runtime errors look like:
 *   TypeError: prompt patrol runtime error
 *       at file:///tmp/broken.js:3:7
 */
function parseJavaScriptError(output: string): ParsedError | undefined {
  const typeMatch = output.match(/^(\w*Error):/m)
  if (!typeMatch) return undefined
  // Look for the location only within this error's own block (up to the next error line) so its name
  // and file/line always come from the same error.
  const rest = output.slice(typeMatch.index! + typeMatch[0].length)
  const nextError = rest.search(/^\w*Error:/m)
  const locationMatch = (nextError === -1 ? rest : rest.slice(0, nextError)).match(
    /at\s+(?:.*?\()?(?:file:\/\/)?([^\s()]+\.(?:[mc]?[jt]s|[jt]sx)):(\d+):(\d+)\)?/,
  )
  return {
    language: "javascript",
    type: typeMatch[1],
    file: locationMatch?.[1],
    line: locationMatch ? Number(locationMatch[2]) : undefined,
    column: locationMatch ? Number(locationMatch[3]) : undefined,
  }
}

const locationPattern = /at\s+(?:.*?\()?(?:file:\/\/)?([^\s()]+\.(?:[mc]?[jt]s|[jt]sx)):(\d+):(\d+)\)?/

/**
 * Returns every error found in captured output, in the order they appear, each
 * with its own type and location. Returns an empty array when the output holds
 * no recognized error. (`parseErrorLocation` keeps returning only the first.)
 */
export function parseAllErrors(output: string): ParsedError[] {
  const found: Array<{ index: number; error: ParsedError }> = []

  for (const match of output.matchAll(/([^\s():]+\.tsx?)\((\d+),(\d+)\):\s*error\s+(TS\d+):/g)) {
    const [, file, line, column, code] = match
    found.push({
      index: match.index!,
      error: { language: "typescript", type: code, file, line: Number(line), column: Number(column) },
    })
  }

  const starts = [...output.matchAll(/^(\w*Error):/gm)]
  starts.forEach((start, i) => {
    // Each error's location is searched only within its own block, up to the next error line.
    const from = start.index! + start[0].length
    const block = output.slice(from, starts[i + 1]?.index ?? output.length)
    const at = block.match(locationPattern)
    found.push({
      index: start.index!,
      error: {
        language: "javascript",
        type: start[1],
        file: at?.[1],
        line: at ? Number(at[2]) : undefined,
        column: at ? Number(at[3]) : undefined,
      },
    })
  })

  return found.sort((a, b) => a.index - b.index).map((entry) => entry.error)
}

/** One-line description of a parsed error; says so explicitly when no location was found. */
export function describeParsedError(error: ParsedError): string {
  if (error.file === undefined || error.line === undefined || error.column === undefined) {
    return `${error.type} (Location not found)`
  }
  return `${error.type} at ${error.file}:${error.line}:${error.column}`
}

/** Description of all parsed errors; says explicitly when none were detected. */
export function describeParsedErrors(errors: ParsedError[]): string {
  if (errors.length === 0) return "No errors detected"
  return errors.map(describeParsedError).join("\n")
}
