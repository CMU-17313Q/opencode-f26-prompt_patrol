import { describe, expect, it } from "bun:test"
import { computeFixConfidence } from "../src/fix-confidence"

const diff = (file: string, lines = 1) =>
  [
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1 @@",
    ...Array.from({ length: lines }, (_, i) => `-old${i}`),
    ...Array.from({ length: lines }, (_, i) => `+new${i}`),
  ].join("\n")

const tsError = "src/app.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'."

describe("computeFixConfidence", () => {
  it("is high for a small, verified fix on the reported file", () => {
    const result = computeFixConfidence({
      diff: diff("src/app.ts"),
      explanation: "The variable was typed as number but assigned a string.",
      verificationPassed: true,
      errorOutput: tsError,
    })
    expect(result.level).toBe("high")
    expect(result.reasons.join("\n")).toContain("where the TS2322 was reported")
  })

  it("is low for a large, unverified, hedging fix elsewhere", () => {
    const result = computeFixConfidence({
      diff: [diff("a.ts", 40), diff("b.ts"), diff("c.ts"), diff("d.ts")].join("\n"),
      explanation: "This might work, you could possibly try this.",
      errorOutput: tsError,
    })
    expect(result.level).toBe("low")
    expect(result.reasons.some((reason) => reason.includes("hedges"))).toBe(true)
    expect(result.reasons.some((reason) => reason.includes("not verified"))).toBe(true)
  })

  it("penalizes failed verification", () => {
    const result = computeFixConfidence({
      diff: diff("src/app.ts"),
      explanation: "Fixed.",
      verificationPassed: false,
      errorOutput: tsError,
    })
    expect(result.level).toBe("medium")
    expect(result.reasons).toContain("Verification failed after the fix")
  })

  it("still returns a result with no error output", () => {
    const result = computeFixConfidence({
      diff: diff("src/app.ts"),
      explanation: "Renamed the variable.",
      verificationPassed: true,
    })
    expect(result.level).toBe("high")
    expect(result.reasons).toContain("No error output was provided")
  })

  it("flags error output that cannot be parsed", () => {
    const result = computeFixConfidence({
      diff: diff("src/app.ts"),
      explanation: "Done.",
      errorOutput: "something went wrong",
    })
    expect(result.reasons).toContain("Could not determine the error type or location from the output")
  })

  it("returns at least one reason for empty input", () => {
    const result = computeFixConfidence({ diff: "", explanation: "" })
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.level).toBe("low")
  })

  it("matches absolute error paths against relative diff paths", () => {
    const result = computeFixConfidence({
      diff: diff("src/broken.js"),
      explanation: "Guard against undefined.",
      verificationPassed: true,
      errorOutput: "TypeError: x\n    at file:///repo/src/broken.js:3:7",
    })
    expect(result.reasons.some((reason) => reason.startsWith("Changes /repo/src/broken.js"))).toBe(true)
  })

  it("reports the diff-size signal", () => {
    const result = computeFixConfidence({
      diff: diff("src/app.ts", 10),
      explanation: "Update the incorrect assignment.",
      errorOutput: tsError,
    })

    expect(result.level).toBe("medium")
    expect(result.reasons).toContain("Moderate diff (20 changed lines)")
  })

  it("reports the file-count signal", () => {
    const result = computeFixConfidence({
      diff: [diff("src/app.ts"), diff("src/helper.ts")].join("\n"),
      explanation: "Update both related files.",
      verificationPassed: true,
      errorOutput: tsError,
    })

    expect(result.reasons).toContain("Changes 2 files")
  })
})
