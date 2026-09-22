import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { listProjectFiles, scanProjectStructure } from "../src/project-structure"

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
