import fs from "node:fs/promises"
import path from "node:path"

const ignoredNames = new Set(["node_modules", ".git", "dist", "build", "out", ".turbo", ".cache", "coverage"])

/** Folders hidden from the structure view unless the user turns them back on (R1). */
export const defaultHiddenFolders: readonly string[] = [...ignoredNames]

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
  const tree = emptyProjectTree()
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
    if (relativeDir && isPermissionError(error)) {
      unreadable.push(relativeDir)
      return undefined
    }
    throw error
  })
  if (!entries) return

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredNames.has(entry.name)) continue
      const child = emptyProjectTree()
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

// Tree nodes are keyed by file names, so they must not inherit Object.prototype: on a plain object a file or
// folder named `__proto__` would replace the node's prototype instead of being added as an entry.
function emptyProjectTree(): ProjectTree {
  return Object.create(null)
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM")
}

/**
 * Lists the entries directly inside `folder` (the project root when empty),
 * folders first and then files, each sorted by name. Returns nothing for a path
 * that does not exist or points at a file.
 */
export function listStructureLevel(tree: ProjectTree, folder: readonly string[] = []): StructureEntry[] {
  const node = folder.reduce<ProjectTree | null | undefined>(
    (current, name) => (current && Object.hasOwn(current, name) ? current[name] : undefined),
    tree,
  )
  if (!node) return []
  return structureEntries(node, folder, folder.length < maxStructureDepth)
}

/** Labels and sorts one folder's entries: folders first, then files, each in case-insensitive name order. */
function structureEntries(node: ProjectTree, folder: readonly string[], foldersOpenable: boolean): StructureEntry[] {
  return Object.keys(node)
    .map((name): StructureEntry => {
      const kind = node[name] === null ? "file" : "folder"
      const purposes = kind === "file" ? knownFilePurposes : knownDirectoryPurposes
      // Own keys only: names like `constructor` or `toString` must not pick up Object.prototype members as labels.
      const key = name.toLowerCase()
      return {
        name,
        kind,
        path: [...folder, name],
        purpose: Object.hasOwn(purposes, key) ? purposes[key] : undefined,
        openable: kind === "folder" && foldersOpenable,
      }
    })
    .sort((a, b) => (a.kind === b.kind ? compareNames(a.name, b.name) : a.kind === "folder" ? -1 : 1))
}

// Case-insensitive name order; names that differ only in case fall back to character-code order.
function compareNames(a: string, b: string) {
  const lower = [a.toLowerCase(), b.toLowerCase()]
  if (lower[0] !== lower[1]) return lower[0] < lower[1] ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

export function structureLocation(folder: readonly string[]) {
  return folder.length ? `${folder.join("/")}/` : "Project root"
}

export function parentStructurePath(folder: readonly string[]) {
  return folder.slice(0, -1)
}

/**
 * Reads one folder of the project (the root when empty), at any depth, leaving out `hidden` folder names.
 * Only this folder is read, so opening the view costs the same however large the project is. Returns nothing
 * for a path that does not exist or points at a file.
 */
export async function listProjectFolder(
  root: string,
  folder: readonly string[] = [],
  hidden: readonly string[] = defaultHiddenFolders,
): Promise<StructureEntry[]> {
  const entries = await fs.readdir(path.join(root, ...folder), { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return []
    throw error
  })
  const node = emptyProjectTree()
  for (const entry of entries) {
    if (entry.isDirectory() && !hidden.includes(entry.name)) node[entry.name] = emptyProjectTree()
    if (entry.isFile()) node[entry.name] = null
  }
  return structureEntries(node, folder, true)
}

/** Rows shown above a folder's entries: `../` one level up and, from two levels deep, "Back to project root". */
export function structureNavigationRows(folder: readonly string[]) {
  if (!folder.length) return []
  const up = parentStructurePath(folder)
  const parent = { title: "../", description: up.length ? `Up to ${up.join("/")}/` : "Up to project root", path: up }
  if (folder.length < 2) return [parent]
  return [parent, { title: "Back to project root", description: "Jump to the top level", path: [] }]
}

/**
 * The entry to highlight after moving from `from` to `to`. Moving up highlights the folder the user came out of;
 * otherwise undefined, and the list starts at its first row.
 */
export function structureHighlightAfterMove(from: readonly string[], to: readonly string[]) {
  if (from.length <= to.length || !to.every((name, i) => from[i] === name)) return undefined
  return from.slice(0, to.length + 1)
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
    const purpose = isFile ? knownFilePurposes[name.toLowerCase()] : knownDirectoryPurposes[name.toLowerCase()]
    if (!purpose) continue
    guesses.push(`${name}${isFile ? "" : "/"} - ${purpose}`)
  }
  return guesses
}
