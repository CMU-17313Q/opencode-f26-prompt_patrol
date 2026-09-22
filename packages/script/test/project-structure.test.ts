import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { listProjectFiles, scanProjectStructure, summarizeProjectStructure } from "../src/project-structure"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function makeSampleRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-structure-"))
  temporaryDirectories.push(root)
  return root
}

describe("project structure scanner", () => {
  it("builds a correct file tree with top-level purpose guesses for a typical JS/TS app", async () => {
    const root = await makeSampleRepo()
    await Bun.write(path.join(root, "package.json"), JSON.stringify({ name: "sample-app" }))
    await Bun.write(path.join(root, "src/index.ts"), "export const main = () => {}")
    await Bun.write(path.join(root, "src/utils/format.ts"), "export const format = (x: string) => x")
    await Bun.write(path.join(root, "test/index.test.ts"), "// test")
    await Bun.write(path.join(root, "docs/guide.md"), "# Guide")
    await Bun.write(path.join(root, "node_modules/dep/index.js"), "module.exports = {}")

    const summary = await summarizeProjectStructure(root)

    expect(summary.tree).toContain("src/")
    expect(summary.tree).toContain("index.ts")
    expect(summary.tree).toContain("test/")
    expect(summary.tree).toContain("docs/")
    expect(summary.tree).not.toContain("node_modules")

    expect(summary.purposeGuesses).toContain("src/ - main application code")
    expect(summary.purposeGuesses).toContain("test/ - test suite")
    expect(summary.purposeGuesses).toContain("docs/ - project documentation")
    expect(summary.purposeGuesses).toContain("package.json - Node.js package manifest and dependencies")
  })

  it("builds a correct file tree with top-level purpose guesses for a monorepo-style layout", async () => {
    const root = await makeSampleRepo()
    await Bun.write(path.join(root, "packages/core/src/index.ts"), "export const core = 1")
    await Bun.write(path.join(root, "packages/core/package.json"), JSON.stringify({ name: "@sample/core" }))
    await Bun.write(path.join(root, "apps/web/main.ts"), "console.log('hi')")
    await Bun.write(path.join(root, "scripts/build.ts"), "// build script")
    await Bun.write(path.join(root, ".github/workflows/ci.yml"), "name: ci")

    const summary = await summarizeProjectStructure(root)

    expect(summary.tree).toContain("packages/")
    expect(summary.tree).toContain("apps/")
    expect(summary.tree).toContain("scripts/")

    expect(summary.purposeGuesses).toContain("apps/ - individual applications in a monorepo")
    expect(summary.purposeGuesses).toContain("packages/ - monorepo packages")
    expect(summary.purposeGuesses).toContain("scripts/ - developer/build scripts")
    expect(summary.purposeGuesses).toContain(".github/ - GitHub Actions workflows and repo automation")
  })

  it("builds a correct file tree with top-level purpose guesses for a simple library with no recognized dirs", async () => {
    const root = await makeSampleRepo()
    await Bun.write(path.join(root, "lib/thing.js"), "module.exports = {}")
    await Bun.write(path.join(root, "README.md"), "# Sample Lib")
    await Bun.write(path.join(root, "LICENSE"), "MIT")
    await Bun.write(path.join(root, "weird-folder-name/thing.js"), "// mystery")

    const summary = await summarizeProjectStructure(root)

    expect(summary.tree).toContain("lib/")
    expect(summary.tree).toContain("weird-folder-name/")

    expect(summary.purposeGuesses).toContain("lib/ - shared library code")
    expect(summary.purposeGuesses).toContain("README.md - project overview and usage documentation")
    expect(summary.purposeGuesses).toContain("LICENSE - license terms")
    // Unrecognized names are left alone rather than guessed at.
    expect(summary.purposeGuesses.some((guess) => guess.startsWith("weird-folder-name/"))).toBe(false)
  })

  it("lists files sorted and excludes ignored directories", async () => {
    const root = await makeSampleRepo()
    await Bun.write(path.join(root, "b.ts"), "")
    await Bun.write(path.join(root, "a.ts"), "")
    await Bun.write(path.join(root, "dist/bundle.js"), "")
    await Bun.write(path.join(root, "node_modules/dep/index.js"), "")

    const files = await listProjectFiles(root)

    expect(files).toEqual(["a.ts", "b.ts"])
  })

  it("scans the deterministic subset used by the component relationship mapper", async () => {
    const root = await makeSampleRepo()
    await Bun.write(path.join(root, "src/index.ts"), "")
    await Bun.write(path.join(root, "packages/shared/package.json"), JSON.stringify({ name: "@sample/shared" }))
    await Bun.write(path.join(root, "docs/guide.md"), "# not source")
    await Bun.write(path.join(root, "node_modules/dep/index.js"), "")

    const structure = await scanProjectStructure(root)

    expect(structure.root).toBe(root)
    expect(structure.files).toEqual(["packages/shared/package.json", "src/index.ts"])
  })
})
