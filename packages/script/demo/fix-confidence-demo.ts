import { computeFixConfidence, type SuggestedFix } from "../src/fix-confidence"

const colors = {
  high: "\x1b[32m",
  medium: "\x1b[33m",
  low: "\x1b[31m",
  reset: "\x1b[0m",
}

const diff = (file: string, lines = 1) =>
  [
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1 @@",
    ...Array.from({ length: lines }, (_, i) => `-old${i}`),
    ...Array.from({ length: lines }, (_, i) => `+new${i}`),
  ].join("\n")

const tsError = "src/app.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'."

function displayConfidence(name: string, fix: SuggestedFix) {
  const result = computeFixConfidence(fix)
  const color = colors[result.level]

  console.log(`\n${name}`)
  console.log(`${color}Confidence: ${result.level.toUpperCase()}${colors.reset}`)

  for (const reason of result.reasons) {
    console.log(`- ${reason}`)
  }

  if (result.level === "low") {
    console.log("⚠ Double-check this fix before applying")
  }
}

displayConfidence("Scenario 1: High confidence", {
  diff: diff("src/app.ts"),
  explanation: "Correct the invalid string assignment.",
  verificationPassed: true,
  errorOutput: tsError,
})

displayConfidence("Scenario 2: Medium confidence", {
  diff: diff("src/app.ts"),
  explanation: "Correct the invalid assignment.",
  verificationPassed: false,
  errorOutput: tsError,
})

displayConfidence("Scenario 3: Low confidence", {
  diff: [diff("src/other.ts", 30), diff("src/helper.ts"), diff("src/config.ts"), diff("src/utils.ts")].join("\n"),
  explanation: "This might possibly fix the problem.",
  verificationPassed: false,
  errorOutput: tsError,
})
