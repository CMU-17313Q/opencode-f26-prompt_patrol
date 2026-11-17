import { expect, test } from "bun:test"
import * as fc from "fast-check"
import {
  describeParsedError,
  describeParsedErrors,
  parseAllErrors,
  type ParsedError,
} from "../src/error-location"

/*
 * Generators
 *
 * The inputs mirror what the bash tool captures from a failed command, and
 * the boundaries the interviewees cared about:
 *  - several errors in one output, with and without a stack frame, so a
 *    location-less error can sit directly above a located one (the pairing
 *    the interviewee said must never happen);
 *  - line/column numbers from 1 up to five digits, to cross digit-count edges;
 *  - every file extension the parser claims to support (.js .mjs .cjs .jsx
 *    .ts .tsx), with and without the "fn (...)" stack-frame wrapper;
 *  - TypeScript diagnostics from different files next to each other;
 *  - build-banner and status lines that contain no error, drawn from words
 *    that cannot accidentally look like an error line or a location.
 */

const jsTypes = ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError"]
const jsExts = ["js", "mjs", "cjs", "jsx", "ts", "tsx"]
const words = ["build", "bundled", "modules", "in", "ms", "compiling", "done", "warning", "no", "issues", "found"]

const name = fc.stringMatching(/^[a-z]{1,8}$/)
const number = fc.integer({ min: 1, max: 99999 })
const message = fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 4 }).map((w) => w.join(" "))
const bannerLine = fc.oneof(
  fc.constantFrom("$ bun build ./src/index.ts", "Bundled 3 modules in 12ms", "Build succeeded", "0 errors", "> tsc --noEmit"),
  message,
)

type Located = { file: string; line: number; column: number }
type JsModel = { kind: "js"; type: string; message: string; wrapped: boolean; at?: Located }
type TsModel = { kind: "ts"; code: string; message: string; at: Located }
type Model = JsModel | TsModel

const jsLocation = fc.record({
  file: fc.tuple(name, fc.constantFrom(...jsExts)).map(([n, e]) => `/tmp/${n}.${e}`),
  line: number,
  column: number,
})
const tsLocation = fc.record({
  file: fc.tuple(name, fc.constantFrom("ts", "tsx")).map(([n, e]) => `${n}.${e}`),
  line: number,
  column: number,
})
const jsError: fc.Arbitrary<JsModel> = fc.record({
  kind: fc.constant("js" as const),
  type: fc.constantFrom(...jsTypes),
  message,
  wrapped: fc.boolean(),
  at: fc.option(jsLocation, { nil: undefined }),
})
const tsError: fc.Arbitrary<TsModel> = fc.record({
  kind: fc.constant("ts" as const),
  code: fc.integer({ min: 1000, max: 9999 }).map((n) => `TS${n}`),
  message,
  at: tsLocation,
})
const anyError: fc.Arbitrary<Model> = fc.oneof(jsError, tsError)

function render(error: Model): string {
  if (error.kind === "ts") {
    return `${error.at.file}(${error.at.line},${error.at.column}): error ${error.code}: ${error.message}`
  }
  const head = `${error.type}: ${error.message}`
  if (!error.at) return head
  const where = `file://${error.at.file}:${error.at.line}:${error.at.column}`
  return `${head}\n    at ${error.wrapped ? `run (${where})` : where}`
}

function expected(error: Model): ParsedError {
  if (error.kind === "ts") {
    return { language: "typescript", type: error.code, ...error.at }
  }
  return {
    language: "javascript",
    type: error.type,
    file: error.at?.file,
    line: error.at?.line,
    column: error.at?.column,
  }
}

test("R1: every error in the output is reported, in order, each with its own type and location", () => {
  // R1: When the output contains more than one error, the parser reports every error it finds, in
  // order, and each error keeps its own type and location.
  // Kind: invariant. Lists of 1-5 mixed JS/TS errors, where some JS errors have no stack frame.
  fc.assert(
    fc.property(fc.array(anyError, { minLength: 1, maxLength: 5 }), (errors) => {
      const output = errors.map(render).join("\n")
      expect(parseAllErrors(output)).toEqual(errors.map(expected))
    }),
  )
})

test("R2: an error without a location has no file/line/column and says the location was not found", () => {
  // R2: When an error has no location in the output, the parser leaves file, line and column empty
  // instead of guessing, and the tool states that no location was found.
  // Kind: invariant. Located and location-less errors are mixed so a missing location sits next to
  // a real one that it must not borrow from.
  fc.assert(
    fc.property(fc.array(anyError, { minLength: 1, maxLength: 5 }), (errors) => {
      const results = parseAllErrors(errors.map(render).join("\n"))
      expect(results).toHaveLength(errors.length)
      results.forEach((result, i) => {
        const model = errors[i]
        const hasLocation = model.kind === "ts" || model.at !== undefined
        if (hasLocation) {
          expect(describeParsedError(result)).not.toContain("Location not found")
          return
        }
        expect(result.file).toBeUndefined()
        expect(result.line).toBeUndefined()
        expect(result.column).toBeUndefined()
        expect(describeParsedError(result)).toContain("Location not found")
      })
    }),
  )
})

test("R3: the location comes only from the current output and the same output gives the same result", () => {
  // R3: The reported location comes only from the current run's output, and the same output always
  // produces the same result.
  // Kind: metamorphic. Changing only the line changes only the line; restoring it restores the result.
  fc.assert(
    fc.property(anyError, fc.integer({ min: 1, max: 1000 }), (error, delta) => {
      if (error.kind === "js" && !error.at) return
      const at = error.at!
      const moved = { ...error, at: { ...at, line: at.line + delta } } as Model
      const first = parseAllErrors(render(error))
      const second = parseAllErrors(render(moved))
      const third = parseAllErrors(render(error))

      expect(second).toHaveLength(1)
      expect(second[0].line).toBe(at.line + delta)
      expect({ ...second[0], line: first[0].line } as ParsedError).toEqual(first[0])
      expect(third).toEqual(first)
    }),
  )
})

test("R4: build banners and other non-error lines do not change the parsed result", () => {
  // R4: Build banners and other non-error lines above an error do not change the parsed result.
  // Kind: metamorphic. Prepending (and interleaving) banner lines must leave the result deep-equal.
  fc.assert(
    fc.property(
      fc.array(anyError, { minLength: 1, maxLength: 4 }),
      fc.array(bannerLine, { minLength: 1, maxLength: 4 }),
      (errors, banner) => {
        const plain = errors.map(render).join("\n")
        const withBanner = [...banner, plain].join("\n")
        expect(parseAllErrors(withBanner)).toEqual(parseAllErrors(plain))
        expect(parseAllErrors(withBanner)).toEqual(errors.map(expected))
      },
    ),
  )
})

test("R5: each TypeScript diagnostic's code, file, line and column come from the same line", () => {
  // R5: For TypeScript diagnostics, the code, file, line and column in each result come from the same
  // diagnostic line.
  // Kind: model/oracle. A deliberately simple line-by-line reference parser is the oracle.
  fc.assert(
    fc.property(
      fc.array(fc.tuple(tsError, fc.array(bannerLine, { maxLength: 2 })), { minLength: 1, maxLength: 5 }),
      (entries) => {
        const lines = entries.flatMap(([error, banner]) => [...banner, render(error)])
        const output = lines.join("\n")

        const oracle = lines.flatMap((line) => {
          const m = /^(\S+\.tsx?)\((\d+),(\d+)\): error (TS\d+): /.exec(line)
          return m ? [{ file: m[1], line: Number(m[2]), column: Number(m[3]), type: m[4] }] : []
        })
        const actual = parseAllErrors(output).map(({ file, line, column, type }) => ({ file, line, column, type }))

        expect(actual).toEqual(oracle)
        expect(oracle).toHaveLength(entries.length)
      },
    ),
  )
})

test("R7: output with no recognizable error yields an empty result and an explicit message", () => {
  // R7: When the output contains no recognizable error, the tool states explicitly that no errors were
  // detected instead of showing nothing.
  // Kind: invariant. Only banner/status lines are generated, including "0 errors" and "Build succeeded".
  fc.assert(
    fc.property(fc.array(bannerLine, { maxLength: 6 }), (lines) => {
      const results = parseAllErrors(lines.join("\n"))
      expect(results).toEqual([])
      expect(describeParsedErrors(results)).toBe("No errors detected")
    }),
  )
})
