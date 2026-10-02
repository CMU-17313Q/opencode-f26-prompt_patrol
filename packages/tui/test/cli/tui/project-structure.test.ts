import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { summarizeProjectStructure } from "@opencode-ai/script/project-structure"
import { projectStructureOptions } from "../../../src/component/dialog-project-structure"

describe("projectStructureOptions", () => {
  test("turns scanner purposes and tree entries into read-only dialog rows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "project-structure-dialog-"))

    try {
      await Bun.write(path.join(root, "package.json"), JSON.stringify({ name: "sample-app" }))
      await Bun.write(path.join(root, "src/index.ts"), "export const main = 1")
      await Bun.write(path.join(root, "node_modules/ignored/index.js"), "module.exports = {}")

      const summary = await summarizeProjectStructure(root)
      const options = projectStructureOptions({ loading: false, summary })

      expect(options).toContainEqual(
        expect.objectContaining({ title: "src/ - main application code", category: "Overview" }),
      )
      expect(options).toContainEqual(expect.objectContaining({ title: "src/", category: "Project files" }))
      expect(options).toContainEqual(expect.objectContaining({ title: "  index.ts", category: "Project files" }))
      expect(options.some((option) => option.title.includes("node_modules"))).toBe(false)
      expect(options.every((option) => option.disabled || !option.onSelect)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})