import fs from "node:fs/promises"
import path from "node:path"

const ignoredDirectories = new Set(["node_modules", ".git", "dist", "build", "out", ".turbo", ".cache", "coverage"])

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]

/** The minimal shape other tools (like the component relationship mapper) need. */
export type ProjectStructure = {
  root: string
  files: readonly string[]
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
