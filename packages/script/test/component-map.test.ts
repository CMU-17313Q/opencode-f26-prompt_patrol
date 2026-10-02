import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mapComponentRelationships } from "../src/component-map"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("mapComponentRelationships", () => {
  it("maps imports between major folders and exposes reverse relationships", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["src/index.ts", "utils/format.ts", "app/main.ts", "packages/shared/package.json"]

    await Bun.write(path.join(root, "src/index.ts"), 'export { format } from "../utils/format"')
    await Bun.write(path.join(root, "utils/format.ts"), "export const format = (value: string) => value")
    await Bun.write(path.join(root, "app/main.ts"), 'import { format } from "../src/index"\nformat("ok")')
    await Bun.write(path.join(root, "packages/shared/package.json"), JSON.stringify({ name: "@course/shared" }))

    const result = await mapComponentRelationships({ root, files })

    expect(result.relationships).toEqual([
      {
        from: "app",
        to: "src",
        kinds: ["import"],
        evidence: ["app/main.ts -> ../src/index"],
      },
      {
        from: "src",
        to: "utils",
        kinds: ["import"],
        evidence: ["src/index.ts -> ../utils/format"],
      },
    ])
    expect(result.components.find((component) => component.name === "utils")).toMatchObject({
      dependsOn: [],
      usedBy: ["src"],
    })
  })

  it("resolves workspace package names from package manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["apps/web/main.ts", "packages/shared/package.json"]

    await Bun.write(path.join(root, "apps/web/main.ts"), 'import { value } from "@course/shared"\nvalue()')
    await Bun.write(path.join(root, "packages/shared/package.json"), JSON.stringify({ name: "@course/shared" }))

    const result = await mapComponentRelationships({ root, files })

    expect(result.relationships[0]).toMatchObject({ from: "apps/web", to: "packages/shared", kinds: ["import"] })
  })

  it("resolves scoped workspace package subpath imports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["apps/web/main.ts", "packages/shared/package.json", "packages/shared/runtime.ts"]

    await Bun.write(path.join(root, "apps/web/main.ts"), 'import { value } from "@course/shared/runtime"\nvalue()')
    await Bun.write(path.join(root, "packages/shared/package.json"), JSON.stringify({ name: "@course/shared" }))
    await Bun.write(path.join(root, "packages/shared/runtime.ts"), "export const value = 1")

    const result = await mapComponentRelationships({ root, files })

    expect(result.relationships[0]).toMatchObject({ from: "apps/web", to: "packages/shared", kinds: ["import"] })
  })

  it("maps relative dynamic imports between components", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["apps/web/main.ts", "packages/shared/runtime.ts"]

    await Bun.write(path.join(root, "apps/web/main.ts"), 'const shared = await import("../../packages/shared/runtime")')
    await Bun.write(path.join(root, "packages/shared/runtime.ts"), "export const value = 1")

    const result = await mapComponentRelationships({ root, files })

    expect(result.relationships[0]).toMatchObject({ from: "apps/web", to: "packages/shared", kinds: ["import"] })
  })

  it("does not treat undeclared external packages as workspace components", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["apps/web/main.ts", "packages/react/index.ts", "packages/utils/index.ts"]

    await Bun.write(path.join(root, "apps/web/main.ts"), 'import React from "react"\nimport { format } from "utils"')
    await Bun.write(path.join(root, "packages/react/index.ts"), "export default {}")
    await Bun.write(path.join(root, "packages/utils/index.ts"), "export const format = (value: string) => value")

    const result = await mapComponentRelationships({ root, files })

    expect(result.relationships).toEqual([])
  })

  it("maps declared workspace dependencies but ignores external dependencies with matching folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["apps/web/package.json", "packages/react/package.json", "packages/shared/package.json"]

    await Bun.write(
      path.join(root, "apps/web/package.json"),
      JSON.stringify({ name: "@course/web", dependencies: { "@course/shared": "workspace:*", react: "^19.0.0" } }),
    )
    await Bun.write(path.join(root, "packages/react/package.json"), JSON.stringify({ name: "@course/react-wrapper" }))
    await Bun.write(path.join(root, "packages/shared/package.json"), JSON.stringify({ name: "@course/shared" }))

    const result = await mapComponentRelationships({ root, files })

    expect(result.relationships).toEqual([
      {
        from: "apps/web",
        to: "packages/shared",
        kinds: ["workspace-dependency"],
        evidence: ["apps/web/package.json -> @course/shared"],
      },
    ])
  })

  it("does not report root-level files as components", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["package.json", "index.ts", "packages/shared/index.ts"]

    await Bun.write(path.join(root, "package.json"), JSON.stringify({ name: "root", dependencies: { "@course/shared": "workspace:*" } }))
    await Bun.write(path.join(root, "index.ts"), 'import { value } from "@course/shared"')
    await Bun.write(path.join(root, "packages/shared/index.ts"), "export const value = 1")

    const result = await mapComponentRelationships({ root, files })

    expect(result.components.map((component) => component.name)).toEqual(["packages/shared"])
    expect(result.relationships).toEqual([])
  })

  it("skips malformed and null package manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-map-"))
    temporaryDirectories.push(root)
    const files = ["apps/web/package.json", "packages/broken/package.json", "packages/empty/package.json"]

    await Bun.write(path.join(root, "apps/web/package.json"), JSON.stringify({ name: "@course/web", dependencies: { "@course/broken": "workspace:*" } }))
    await Bun.write(path.join(root, "packages/broken/package.json"), "{")
    await Bun.write(path.join(root, "packages/empty/package.json"), "null")

    const result = await mapComponentRelationships({ root, files })

    expect(result.components.map((component) => component.name)).toEqual(["apps/web", "packages/broken", "packages/empty"])
    expect(result.relationships).toEqual([])
  })
})
