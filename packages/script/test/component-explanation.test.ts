import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mapComponentRelationships, type ComponentMap } from "../src/component-map"
import { explainComponent, explainComponents, renderComponentExplanations } from "../src/component-explanation"
import { scanProjectStructure } from "../src/project-structure"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function makeMap(components: ComponentMap["components"], relationships: ComponentMap["relationships"] = []): ComponentMap {
  return { root: "/repo", components, relationships }
}

describe("explainComponent", () => {
  it("describes a component nothing depends on as an entry point", () => {
    const component = { name: "app", files: 2, dependsOn: ["src"], usedBy: [] }
    const explanation = explainComponent(component, makeMap([component]))

    expect(explanation.role).toBe("entry-point")
    expect(explanation.headline).toBe("app/ - application entry code")
    expect(explanation.why).toContain("Nothing else in the project depends on it")
    expect(explanation.why).toContain("It builds on src")
  })

  it("describes a component with no dependencies of its own as foundational", () => {
    const component = { name: "utils", files: 1, dependsOn: [], usedBy: ["src", "app"] }
    const explanation = explainComponent(component, makeMap([component]))

    expect(explanation.role).toBe("foundational")
    expect(explanation.headline).toBe("utils/ - shared utility functions")
    expect(explanation.why).toContain("utils holds 1 file.")
    expect(explanation.why).toContain("It is used by src and app")
  })

  it("describes a component with links in both directions as a connecting layer", () => {
    const component = { name: "src", files: 4, dependsOn: ["utils"], usedBy: ["app"] }
    const explanation = explainComponent(component, makeMap([component]))

    expect(explanation.role).toBe("middle-layer")
    expect(explanation.why).toContain("It builds on utils, and is used in turn by app.")
    expect(explanation.why).toContain("read utils first")
  })

  it("describes an unconnected component as standalone", () => {
    const component = { name: "docs", files: 3, dependsOn: [], usedBy: [] }
    const explanation = explainComponent(component, makeMap([component]))

    expect(explanation.role).toBe("standalone")
    expect(explanation.headline).toBe("docs/ - project documentation")
    expect(explanation.why).toContain("stands on its own")
  })

  it("falls back to the component's role when the folder name is not recognised", () => {
    const component = { name: "widgets", files: 2, dependsOn: [], usedBy: [] }
    const explanation = explainComponent(component, makeMap([component]))

    expect(explanation.headline).toBe("widgets/ - a self-contained piece")
    expect(explanation.why).toStartWith("widgets holds 2 files.")
  })

  it("warns when a relationship exists only in package.json", () => {
    const component = { name: "packages/web", files: 1, dependsOn: ["packages/shared"], usedBy: [] }
    const explanation = explainComponent(
      component,
      makeMap(
        [component],
        [
          {
            from: "packages/web",
            to: "packages/shared",
            kinds: ["workspace-dependency"],
            evidence: ["packages/web/package.json -> @course/shared"],
          },
        ],
      ),
    )

    expect(explanation.why).toContain("declared only in package.json")
  })

  it("stays quiet about package.json when the same link is also a real import", () => {
    const component = { name: "packages/web", files: 1, dependsOn: ["packages/shared"], usedBy: [] }
    const explanation = explainComponent(
      component,
      makeMap(
        [component],
        [
          {
            from: "packages/web",
            to: "packages/shared",
            kinds: ["import", "workspace-dependency"],
            evidence: ["packages/web/main.ts -> @course/shared"],
          },
        ],
      ),
    )

    expect(explanation.why).not.toContain("package.json")
  })

  it("does not add a trailing slash to a top-level file", () => {
    const component = { name: "package.json", files: 1, dependsOn: ["packages/shared"], usedBy: [] }

    expect(explainComponent(component, makeMap([component])).headline).toStartWith("package.json - ")
  })

  it("suggests the dependency with the fewest dependencies of its own as a starting point", () => {
    const src = { name: "src", files: 3, dependsOn: ["api", "utils"], usedBy: ["app"] }
    const api = { name: "api", files: 2, dependsOn: ["utils"], usedBy: ["src"] }
    const utils = { name: "utils", files: 1, dependsOn: [], usedBy: ["src", "api"] }

    expect(explainComponent(src, makeMap([src, api, utils])).why).toContain("read utils first")
  })
})

describe("explainComponents", () => {
  it("explains every component in the map, in the same order", () => {
    const components = [
      { name: "app", files: 1, dependsOn: ["src"], usedBy: [] },
      { name: "src", files: 2, dependsOn: ["utils"], usedBy: ["app"] },
      { name: "utils", files: 1, dependsOn: [], usedBy: ["src"] },
    ]

    const explanations = explainComponents(makeMap(components))

    expect(explanations.map((explanation) => explanation.name)).toEqual(["app", "src", "utils"])
    expect(explanations.map((explanation) => explanation.role)).toEqual(["entry-point", "middle-layer", "foundational"])
  })
})

describe("renderComponentExplanations", () => {
  it("renders each component as a headline followed by an indented explanation", () => {
    const component = { name: "utils", files: 1, dependsOn: [], usedBy: ["src"] }
    const rendered = renderComponentExplanations(explainComponents(makeMap([component])))

    expect(rendered.split("\n")[0]).toBe("utils/ - shared utility functions")
    expect(rendered.split("\n")[1]).toStartWith("  utils holds 1 file")
  })
})

describe("end to end on a scanned repo", () => {
  it("explains the components of a real directory tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "component-explanation-"))
    temporaryDirectories.push(root)

    await Bun.write(path.join(root, "utils/format.ts"), "export const format = (value: string) => value")
    await Bun.write(path.join(root, "src/index.ts"), 'export { format } from "../utils/format"')
    await Bun.write(path.join(root, "app/main.ts"), 'import { format } from "../src/index"\nformat("ok")')

    const explanations = explainComponents(await mapComponentRelationships(await scanProjectStructure(root)))
    const byName = new Map(explanations.map((explanation) => [explanation.name, explanation]))

    expect(byName.get("utils")?.role).toBe("foundational")
    expect(byName.get("src")?.role).toBe("middle-layer")
    expect(byName.get("app")?.role).toBe("entry-point")
    expect(byName.get("utils")?.why).toContain("changes here ripple outward")
  })
})
