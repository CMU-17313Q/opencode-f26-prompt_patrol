import type { Component, ComponentMap } from "./component-map"
import { knownDirectoryPurposes } from "./project-structure"

/**
 * Where a component sits in the project, inferred from the direction of its
 * relationships rather than from its name.
 */
export type ComponentRole = "entry-point" | "foundational" | "middle-layer" | "standalone"

export type ComponentExplanation = {
  name: string
  role: ComponentRole
  /** One-line summary, e.g. `utils/ - shared utility functions`. */
  headline: string
  /** Short plain-language paragraph explaining the component's role. */
  why: string
}

const roleSummaries: Record<ComponentRole, string> = {
  "entry-point": "an entry point",
  foundational: "foundational code",
  "middle-layer": "a connecting layer",
  standalone: "a self-contained piece",
}

/**
 * Turns a component map into a short plain-language explanation of what each
 * component is for and how a newcomer should approach it.
 */
export function explainComponents(map: ComponentMap): ComponentExplanation[] {
  return map.components.map((component) => explainComponent(component, map))
}

export function explainComponent(component: Component, map: ComponentMap): ComponentExplanation {
  const role = roleFor(component)
  const purpose = purposeFor(component.name)
  const sentences = [sizeSentence(component), ...roleSentences(component, role, map)]

  const workspace = workspaceSentence(component, map)
  if (workspace) sentences.push(workspace)

  return {
    name: component.name,
    role,
    headline: `${displayName(component.name)} - ${purpose ?? roleSummaries[role]}`,
    why: sentences.join(" "),
  }
}

/** Renders explanations as the walkthrough text a student would read. */
export function renderComponentExplanations(explanations: readonly ComponentExplanation[]): string {
  return explanations.map((explanation) => `${explanation.headline}\n  ${explanation.why}`).join("\n\n")
}

function roleFor(component: Component): ComponentRole {
  const dependsOn = component.dependsOn.length
  const usedBy = component.usedBy.length
  if (dependsOn > 0 && usedBy === 0) return "entry-point"
  if (dependsOn === 0 && usedBy > 0) return "foundational"
  if (dependsOn > 0 && usedBy > 0) return "middle-layer"
  return "standalone"
}

function purposeFor(name: string): string | undefined {
  const leaf = name.slice(name.lastIndexOf("/") + 1)
  return knownDirectoryPurposes[leaf.toLowerCase()]
}

/** Top-level files such as `package.json` are components too, but they are not folders. */
function displayName(name: string): string {
  const leaf = name.slice(name.lastIndexOf("/") + 1)
  return leaf.includes(".") ? name : `${name}/`
}

function sizeSentence(component: Component): string {
  return `${component.name} holds ${component.files} ${component.files === 1 ? "file" : "files"}.`
}

function roleSentences(component: Component, role: ComponentRole, map: ComponentMap): string[] {
  const dependsOn = formatList(component.dependsOn)
  const usedBy = formatList(component.usedBy)

  switch (role) {
    case "entry-point":
      return [
        "Nothing else in the project depends on it, so it is a starting point rather than something other code builds on.",
        `It builds on ${dependsOn}, so reading it first shows you how those pieces fit together.`,
      ]
    case "foundational":
      return [
        "It does not depend on any other component, so you can read it on its own without chasing references.",
        `It is used by ${usedBy}, so changes here ripple outward and should be made carefully.`,
      ]
    case "middle-layer":
      return [
        `It builds on ${dependsOn}, and is used in turn by ${usedBy}.`,
        `That makes it a connector, so read ${suggestedStartingPoint(component, map)} first if you want this code to make sense in context.`,
      ]
    case "standalone":
      return [
        "Nothing depends on it and it depends on nothing else, so it stands on its own.",
        "That usually means configuration, assets, or documentation rather than running code, or a component that is not wired in yet.",
      ]
  }
}

/** Of a component's dependencies, the one with the fewest of its own is the easiest to read first. */
function suggestedStartingPoint(component: Component, map: ComponentMap): string {
  const dependencies = component.dependsOn
    .map((name) => map.components.find((candidate) => candidate.name === name))
    .filter((candidate): candidate is Component => candidate !== undefined)

  if (dependencies.length === 0) return component.dependsOn[0] ?? "its dependencies"

  return dependencies.reduce((simplest, candidate) =>
    candidate.dependsOn.length < simplest.dependsOn.length ? candidate : simplest,
  ).name
}

/**
 * Only worth calling out when a link exists purely in package.json, since those
 * are the ones a newcomer cannot find by searching the source for imports.
 */
function workspaceSentence(component: Component, map: ComponentMap): string | undefined {
  const hidden = map.relationships.some(
    (relationship) =>
      (relationship.from === component.name || relationship.to === component.name) &&
      relationship.kinds.includes("workspace-dependency") &&
      !relationship.kinds.includes("import"),
  )
  return hidden
    ? "At least one of these links is declared only in package.json, so searching the source for imports will not reveal it."
    : undefined
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return "nothing"
  if (items.length === 1) return items[0] ?? "nothing"
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`
}
