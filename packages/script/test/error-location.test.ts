import { describe, expect, it } from "bun:test"
import { parseErrorLocation } from "../src/error-location"

describe("error location parser", () => {
  describe("javascript", () => {
    it("parses a TypeError from a thrown Error", () => {
      const output = [
        "TypeError: Cannot read properties of undefined (reading 'name')",
        "    at getName (file:///tmp/broken.js:3:7)",
        "    at file:///tmp/broken.js:6:1",
      ].join("\n")

      expect(parseErrorLocation(output)).toEqual({
        language: "javascript",
        type: "TypeError",
        file: "/tmp/broken.js",
        line: 3,
        column: 7,
      })
    })

    it("parses a ReferenceError for an undefined variable", () => {
      const output = ["ReferenceError: total is not defined", "    at file:///tmp/sum.js:2:1"].join("\n")

      expect(parseErrorLocation(output)).toEqual({
        language: "javascript",
        type: "ReferenceError",
        file: "/tmp/sum.js",
        line: 2,
        column: 1,
      })
    })

    it("parses a SyntaxError with no stack frame", () => {
      const output = ["SyntaxError: Unexpected end of input"].join("\n")

      expect(parseErrorLocation(output)).toEqual({
        language: "javascript",
        type: "SyntaxError",
        file: undefined,
        line: undefined,
        column: undefined,
      })
    })

    it("parses a RangeError from a recursive call", () => {
      const output = [
        "RangeError: Maximum call stack size exceeded",
        "    at recurse (file:///tmp/stack.js:1:14)",
        "    at recurse (file:///tmp/stack.js:1:24)",
      ].join("\n")

      expect(parseErrorLocation(output)).toEqual({
        language: "javascript",
        type: "RangeError",
        file: "/tmp/stack.js",
        line: 1,
        column: 14,
      })
    })

    it("parses a plain Error thrown from an mjs entrypoint", () => {
      const output = ["Error: prompt patrol runtime error", "    at file:///tmp/entry.mjs:1:7"].join("\n")

      expect(parseErrorLocation(output)).toEqual({
        language: "javascript",
        type: "Error",
        file: "/tmp/entry.mjs",
        line: 1,
        column: 7,
      })
    })
  })

  describe("typescript", () => {
    it("parses a type mismatch diagnostic (TS2322)", () => {
      const output = `broken.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.`

      expect(parseErrorLocation(output)).toEqual({
        language: "typescript",
        type: "TS2322",
        file: "broken.ts",
        line: 1,
        column: 7,
      })
    })

    it("parses an unknown property diagnostic (TS2339)", () => {
      const output = `user.ts(12,15): error TS2339: Property 'emial' does not exist on type 'User'.`

      expect(parseErrorLocation(output)).toEqual({
        language: "typescript",
        type: "TS2339",
        file: "user.ts",
        line: 12,
        column: 15,
      })
    })

    it("parses an unresolved name diagnostic (TS2304)", () => {
      const output = `config.ts(4,10): error TS2304: Cannot find name 'Settingz'.`

      expect(parseErrorLocation(output)).toEqual({
        language: "typescript",
        type: "TS2304",
        file: "config.ts",
        line: 4,
        column: 10,
      })
    })

    it("parses an argument count diagnostic (TS2554) inside a .tsx file", () => {
      const output = `Button.tsx(20,3): error TS2554: Expected 1 arguments, but got 2.`

      expect(parseErrorLocation(output)).toEqual({
        language: "typescript",
        type: "TS2554",
        file: "Button.tsx",
        line: 20,
        column: 3,
      })
    })

    it("parses the first diagnostic when tsc reports several", () => {
      const output = [
        `broken.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.`,
        `broken.ts(5,1): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.`,
      ].join("\n")

      expect(parseErrorLocation(output)).toEqual({
        language: "typescript",
        type: "TS2322",
        file: "broken.ts",
        line: 1,
        column: 7,
      })
    })
  })

  it("returns undefined for output with no recognized error shape", () => {
    expect(parseErrorLocation("Command exited with code 0.")).toBeUndefined()
  })
})
