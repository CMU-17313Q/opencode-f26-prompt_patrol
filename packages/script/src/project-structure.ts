import fs from "node:fs/promises"
import path from "node:path"

const ignoredNames = new Set(["node_modules", ".git", "dist", "build", "out", ".turbo", ".cache", "coverage"])

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]

/** Plain-language purpose for common directory names, keyed by lowercased name. */
export const knownDirectoryPurposes: Record<string, string> = {
  src: "main application code",
  lib: "shared library code",
  app: "application entry code",
  apps: "individual applications in a monorepo",
  packages: "monorepo packages",
  server: "backend/server code",
  client: "frontend/client code",
  web: "web frontend code",
  api: "API route/handler code",
  components: "UI components",
  pages: "page-level UI routes",
  public: "static assets served as-is",
  static: "static assets",
  assets: "images, fonts, and other static assets",
  test: "test suite",
  tests: "test suite",
  __tests__: "test suite",
  spec: "test specifications",
  e2e: "end-to-end tests",
  docs: "project documentation",
  doc: "project documentation",
  examples: "usage examples",
  scripts: "developer/build scripts",
  script: "developer/build scripts",
  tools: "developer tooling",
  config: "configuration files",
  dist: "build output (compiled/bundled code)",
  build: "build output",
  vendor: "vendored third-party dependencies",
  migrations: "database migrations",
  types: "shared TypeScript type definitions",
  utils: "shared utility functions",
  util: "shared utility functions",
  models: "data models",
  ".github": "GitHub Actions workflows and repo automation",
}

/** Plain-language purpose for common file names, keyed by lowercased name. */
export const knownFilePurposes: Record<string, string> = {
  "package.json": "Node.js package manifest and dependencies",
  "tsconfig.json": "TypeScript compiler configuration",
  "readme.md": "project overview and usage documentation",
  license: "license terms",
  "license.md": "license terms",
  dockerfile: "container build definition",
  makefile: "build and task automation",
  "go.mod": "Go module definition",
  "cargo.toml": "Rust package manifest",
  "pyproject.toml": "Python project/package manifest",
  "requirements.txt": "Python dependency list",
}

/** A directory tree, where a file leaf is `null` and a folder is a nested object. */
export type ProjectTree = { [name: string]: ProjectTree | null }

/** The minimal shape other tools (like the component relationship mapper) need. */
export type ProjectStructure = {
  root: string
  files: readonly string[]
}

export type ProjectSummary = {
  root: string
  tree: string
  purposeGuesses: readonly string[]
}

/**
 * Recursively lists every file under `root`, skipping entries with common noise
 * names (node_modules, build output, VCS metadata). Paths are relative to `root`,
 * use "/" separators, and are returned sorted for deterministic output.
 */
export async function listProjectFiles(root: string): Promise<string[]> {
  const files: string[] = []
  await walk(root, "", files)
  return files.sort()
}

async function walk(root: string, relativeDir: string, files: string[]) {
  const entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true })
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await walk(root, relativePath, files)
      continue
    }
    if (entry.isFile()) files.push(relativePath)
  }
}

/**
 * Scans a repo and returns the deterministic subset of files that downstream
 * tools (e.g. the component relationship mapper) care about: source files and
 * package manifests.
 */
export async function scanProjectStructure(root: string): Promise<ProjectStructure> {
  const files = await listProjectFiles(root)
  const relevant = files.filter((file) => {
    const extension = path.posix.extname(file)
    return path.posix.basename(file) === "package.json" || sourceExtensions.includes(extension)
  })
  return { root, files: relevant }
}

/**
 * Scans a repo and returns a human-readable file/folder tree plus short
 * purpose guesses for top-level entries, e.g. "src/ - main application code".
 */
export async function summarizeProjectStructure(root: string): Promise<ProjectSummary> {
  const files = await listProjectFiles(root)
  const tree = buildTree(files)
  return {
    root,
    tree: renderTree(tree).join("\n"),
    purposeGuesses: guessTopLevelPurposes(tree),
  }
}

/** Folders can be opened this many levels below the top level of the project. */
export const maxStructureDepth = 2

export type StructureEntry = {
  name: string
  kind: "folder" | "file"
  /** Names from the project root down to this entry, including its own. */
  path: string[]
  purpose?: string
  /** False for files and for folders already at the depth limit. */
  openable: boolean
}

const unreadableProjectTreePaths = new WeakMap<ProjectTree, string[]>()

/**
 * Scans the levels the viewer can open, skipping common noise directories and keeping unreadable folders visible.
 * Files with the same names are retained here, unlike in `listProjectFiles`.
 */
export async function scanProjectTree(root: string): Promise<ProjectTree> {
  const tree = emptyTree()
  const unreadable: string[] = []
  await scanTreeLevel(root, "", tree, 0, unreadable)
  unreadableProjectTreePaths.set(tree, unreadable)
  return tree
}

export function unreadableProjectTreeDirectories(tree: ProjectTree) {
  return unreadableProjectTreePaths.get(tree) ?? []
}

async function scanTreeLevel(
  root: string,
  relativeDir: string,
  tree: ProjectTree,
  depth: number,
  unreadable: string[],
) {
  const entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true }).catch((error: unknown) => {
    const code = errorCode(error)
    if (relativeDir && (code === "EACCES" || code === "EPERM")) {
      unreadable.push(relativeDir)
      return undefined
    }
    // The dialog shows this message as-is, so a missing project folder must not surface raw ENOENT text.
    if (!relativeDir && (code === "ENOENT" || code === "ENOTDIR")) throw new Error(`Folder not found: ${root}`)
    throw error
  })
  if (!entries) return

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredNames.has(entry.name)) continue
      const child = emptyTree()
      tree[entry.name] = child
      if (depth < maxStructureDepth) {
        await scanTreeLevel(
          root,
          relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
          child,
          depth + 1,
          unreadable,
        )
      }
      continue
    }
    if (entry.isFile()) tree[entry.name] = null
  }
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error ? error.code : undefined
}

// Without a prototype, a folder or file named "__proto__" is stored as a normal entry instead of
// replacing the tree's prototype and disappearing from the listing.
function emptyTree(): ProjectTree {
  return Object.create(null)
}

// Own-key lookup only, so names like "constructor" don't match properties every object inherits.
function purposeFor(name: string, kind: StructureEntry["kind"]) {
  const purposes = kind === "file" ? knownFilePurposes : knownDirectoryPurposes
  const key = name.toLowerCase()
  return Object.hasOwn(purposes, key) ? purposes[key] : undefined
}

/**
 * Lists the entries directly inside `folder` (the project root when empty),
 * folders first and then files, each sorted by name. Returns nothing for a path
 * that does not exist or points at a file.
 */
export function listStructureLevel(tree: ProjectTree, folder: readonly string[] = []): StructureEntry[] {
  const node = folder.reduce<ProjectTree | null | undefined>((current, name) => current?.[name], tree)
  if (!node) return []

  return Object.keys(node)
    .map((name): StructureEntry => {
      const kind = node[name] === null ? "file" : "folder"
      return {
        name,
        kind,
        path: [...folder, name],
        purpose: purposeFor(name, kind),
        openable: kind === "folder" && folder.length < maxStructureDepth,
      }
    })
    .sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : 1) : a.kind === "folder" ? -1 : 1))
}

export function structureLocation(folder: readonly string[]) {
  return folder.length ? `${folder.join("/")}/` : "Project root"
}

export function parentStructurePath(folder: readonly string[]) {
  return folder.slice(0, -1)
}

/** Purposes are guessed from names alone, so the viewer always labels them as guesses. */
export function structureEntryDescription(entry: Pick<StructureEntry, "purpose">) {
  return entry.purpose === undefined ? undefined : `likely: ${entry.purpose}`
}

export function structureEntryTitle(entry: Pick<StructureEntry, "kind" | "name">) {
  return entry.kind === "folder" ? `${entry.name}/` : entry.name
}

function buildTree(files: readonly string[]): ProjectTree {
  const root: ProjectTree = {}
  for (const file of files) {
    const parts = file.split("/")
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1
      const part = parts[i]
      if (isFile) {
        node[part] = null
        continue
      }
      node[part] = node[part] ?? {}
      node = node[part] as ProjectTree
    }
  }
  return root
}

function renderTree(node: ProjectTree, indent = ""): string[] {
  const lines: string[] = []
  for (const name of Object.keys(node).sort()) {
    const child = node[name]
    const isFile = child === null
    lines.push(`${indent}${name}${isFile ? "" : "/"}`)
    if (!isFile) lines.push(...renderTree(child, `${indent}  `))
  }
  return lines
}

function guessTopLevelPurposes(root: ProjectTree): string[] {
  const guesses: string[] = []
  for (const name of Object.keys(root).sort()) {
    const isFile = root[name] === null
    const purpose = purposeFor(name, isFile ? "file" : "folder")
    if (!purpose) continue
    guesses.push(`${name}${isFile ? "" : "/"} - ${purpose}`)
  }
  return guesses
}
