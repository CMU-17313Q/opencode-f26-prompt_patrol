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
  const locationMatch = output.match(/at\s+(?:.*?\()?(?:file:\/\/)?([^\s()]+\.[mc]?js):(\d+):(\d+)\)?/)
  return {
    language: "javascript",
    type: typeMatch[1],
    file: locationMatch?.[1],
    line: locationMatch ? Number(locationMatch[2]) : undefined,
    column: locationMatch ? Number(locationMatch[3]) : undefined,
  }
}
