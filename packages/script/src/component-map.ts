import path from "node:path"

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]
const componentRoots = new Set(["apps", "libs", "modules", "packages"])

export type ProjectStructure = {
  root: string
  files: readonly string[]
}

export type ComponentRelationship = {
  from: string
  to: string
  kinds: readonly ("import" | "workspace-dependency")[]
  evidence: readonly string[]
}

export type Component = {
  name: string
  files: number
  dependsOn: readonly string[]
  usedBy: readonly string[]
}

export type ComponentMap = {
  root: string
  components: readonly Component[]
  relationships: readonly ComponentRelationship[]
}

export async function mapComponentRelationships(structure: ProjectStructure): Promise<ComponentMap> {
  const files = structure.files.map((file) => file.replaceAll("\\", "/").replace(/^\.\//, "")).filter(Boolean)
  const sourceFiles = files.filter((file) => sourceExtensions.includes(path.posix.extname(file)))
  const components = new Map<string, string[]>()

  for (const file of files) {
    const component = componentFor(file)
    components.set(component, [...(components.get(component) ?? []), file])
  }

  const fileComponents = new Map(files.map((file) => [file, componentFor(file)]))
  const componentNames = new Set(components.keys())
  const packageNames = new Map<string, string>()
  for (const packageFile of files.filter((file) => path.posix.basename(file) === "package.json")) {
    const packageData = await Bun.file(path.join(structure.root, packageFile)).json()
    if (typeof packageData.name === "string") packageNames.set(packageData.name, fileComponents.get(packageFile) ?? componentFor(packageFile))
  }
  const relationships = new Map<string, { kinds: Set<"import" | "workspace-dependency">; evidence: Set<string> }>()

  for (const sourceFile of sourceFiles) {
    const from = fileComponents.get(sourceFile)
    if (!from) continue
    const contents = await Bun.file(path.join(structure.root, sourceFile)).text()
    const imports = [...contents.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g), ...contents.matchAll(/require\(["']([^"']+)["']\)/g)]

    for (const match of imports) {
      const specifier = match[1]
      if (!specifier) continue
      const targetFile = resolveImport(sourceFile, specifier, files)
      const to = targetFile ? fileComponents.get(targetFile) : resolvePackageImport(specifier, componentNames, packageNames)
      if (!to || to === from) continue
      addRelationship(relationships, from, to, "import", `${sourceFile} -> ${specifier}`)
    }
  }

  for (const packageFile of files.filter((file) => path.posix.basename(file) === "package.json")) {
    const from = fileComponents.get(packageFile)
    if (!from) continue
    const contents = await Bun.file(path.join(structure.root, packageFile)).json()
    const dependencies = Object.keys({ ...contents.dependencies, ...contents.devDependencies, ...contents.peerDependencies })
    for (const dependency of dependencies) {
      const to = resolvePackageImport(dependency, componentNames, packageNames)
      if (to && to !== from) addRelationship(relationships, from, to, "workspace-dependency", `${packageFile} -> ${dependency}`)
    }
  }

  const relationshipList = [...relationships.entries()]
    .map(([key, value]) => {
      const [from, to] = key.split("\0")
      return { from, to, kinds: [...value.kinds].sort(), evidence: [...value.evidence].sort() }
    })
    .sort((left, right) => `${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`))

  return {
    root: structure.root,
    components: [...componentNames].sort().map((name) => ({
      name,
      files: components.get(name)?.length ?? 0,
      dependsOn: relationshipList.filter((relationship) => relationship.from === name).map((relationship) => relationship.to),
      usedBy: relationshipList.filter((relationship) => relationship.to === name).map((relationship) => relationship.from),
    })),
    relationships: relationshipList,
  }
}

function componentFor(file: string) {
  const parts = file.split("/")
  return componentRoots.has(parts[0] ?? "") ? parts.slice(0, 2).join("/") : (parts[0] ?? file)
}

function resolveImport(sourceFile: string, specifier: string, files: readonly string[]) {
  if (!specifier.startsWith(".")) return undefined
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier))
  const candidates = [base, ...sourceExtensions.map((extension) => `${base}${extension}`), ...sourceExtensions.map((extension) => `${base}/index${extension}`)]
  return candidates.find((candidate) => files.includes(candidate))
}

function resolvePackageImport(specifier: string, components: ReadonlySet<string>, packageNames: ReadonlyMap<string, string>) {
  const declaredPackage = packageNames.get(specifier)
  if (declaredPackage) return declaredPackage
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]
  return [...components].find((component) => component.endsWith(`/${packageName}`) || component === packageName)
}

function addRelationship(
  relationships: Map<string, { kinds: Set<"import" | "workspace-dependency">; evidence: Set<string> }>,
  from: string,
  to: string,
  kind: "import" | "workspace-dependency",
  evidence: string,
) {
  const key = `${from}\0${to}`
  const relationship = relationships.get(key) ?? { kinds: new Set(), evidence: new Set() }
  relationship.kinds.add(kind)
  relationship.evidence.add(evidence)
  relationships.set(key, relationship)
}