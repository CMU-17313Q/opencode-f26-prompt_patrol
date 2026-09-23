import fs from "node:fs/promises"
import path from "node:path"

const ignoredDirectories = new Set(["node_modules", ".git", "dist", "build", "out", ".turbo", ".cache", "coverage"])

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

const knownFilePurposes: Record<string, string> = {
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
 * Recursively lists every file under `root`, skipping common noise directories
 * (node_modules, build output, VCS metadata). Paths are relative to `root`,
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
    if (ignoredDirectories.has(entry.name)) continue
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
