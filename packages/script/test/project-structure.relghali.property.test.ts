// Property-based tests for Rawan's (relghali) View Project Structure requirements.
// Requirement IDs and wording match traceability/relghali.md.
import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  defaultHiddenFolders,
  knownDirectoryPurposes,
  knownFilePurposes,
  listProjectFolder,
  listStructureLevel,
  structureHighlightAfterMove,
  structureNavigationRows,
  type ProjectTree,
  type StructureEntry,
} from "../src/project-structure"

// A generated project: a folder maps names to `null` (a file) or another folder.
type Spec = { [name: string]: Spec | null }

// Names chosen to reach the cases the requirements care about:
// - case twins (`README.md`/`readme.md`, `Docs`/`docs`) for R2's "names that differ only in case" tie-break;
// - mixed case, digits and `_` so case-insensitive order differs from character-code order (R2);
// - dot-folders and dot-files (`.github`, `.env`) that must stay visible (R1);
// - names that exist on every JS object (`constructor`, `toString`, `__proto__`), because entries are keyed by name.
const caseTwins = ["readme.md", "docs"]
const projectNames = [
  "src",
  "lib",
  "Docs",
  "README.md",
  "Zebra.ts",
  "apple.ts",
  "B.ts",
  "_util",
  "10",
  "9.ts",
  ".github",
  ".env",
  "constructor",
  "toString",
  "__proto__",
  ...caseTwins,
]

// Random projects: up to 5 entries per folder, nested up to 5 levels, past the old 2-level limit (R4).
function projectSpec(names: readonly string[]) {
  return fc.letrec<{ folder: Spec }>((tie) => ({
    folder: fc.dictionary(
      fc.constantFrom(...names),
      fc.oneof({ depthSize: "small", maxDepth: 5 }, fc.constant(null), tie("folder")),
      { maxKeys: 5 },
    ),
  })).folder
}

test("R1: hidden folders never appear at any level, all others do", async () => {
  // R1: By default node_modules, .git, dist, build, out, .turbo, .cache, coverage are hidden at every level. Other
  // dot-folders like .github are shown. The user can toggle each name or "Show all folders".
  // Kind: invariant. Hidden names are mixed into random projects at any depth, and the hidden list is a random
  // subset of the defaults: all 8 (the default), none ("Show all folders"), or anything in between (toggles).
  const names = await usableNames([...projectNames, ...defaultHiddenFolders])
  await fc.assert(
    fc.asyncProperty(projectSpec(names), fc.subarray([...defaultHiddenFolders]), (spec, hidden) =>
      withProject(spec, async (root) => {
        const shown = await openEveryFolder(root, hidden)
        expect(shown.filter((entry) => entry.kind === "folder" && hidden.includes(entry.name))).toEqual([])

        // Every folder not inside a hidden folder is listed under its parent.
        const expected = flatten(spec).filter(
          (entry) => entry.kind === "folder" && !entry.path.some((name) => hidden.includes(name)),
        )
        expect(shown.filter((entry) => entry.kind === "folder").map((entry) => entry.path.join("/")).sort()).toEqual(
          expected.map((entry) => entry.path.join("/")).sort(),
        )
      }),
    ),
    { numRuns: 50 },
  )
})

test("R2: every level lists exactly its direct children, folders first, case-insensitive order", async () => {
  // R2: Each level lists only the open folder's direct children, folders first, then files. Each group is sorted by
  // name ignoring case; names that differ only in case are ordered by character code.
  // Kind: model/oracle. The oracle works from the flat list of generated paths: a folder's children are the paths
  // exactly one segment longer that start with it, sorted by the key "lowercased name, then original name".
  const names = await usableNames(projectNames)
  await fc.assert(
    fc.asyncProperty(projectSpec(names), (spec) =>
      withProject(spec, async (root) => {
        const entries = flatten(spec)
        const folders = [[], ...entries.filter((entry) => entry.kind === "folder").map((entry) => entry.path)]
        for (const folder of folders) {
          const children = entries.filter(
            (entry) => entry.path.length === folder.length + 1 && folder.every((name, i) => entry.path[i] === name),
          )
          const sorted = (kind: "folder" | "file") =>
            children
              .filter((entry) => entry.kind === kind)
              .map((entry) => `${entry.path.at(-1)!.toLowerCase()}\0${entry.path.at(-1)!}`)
              .sort()
              .map((key) => key.split("\0")[1])
              .map((name) => ({ kind, name, path: [...folder, name] }))
          const actual = (await listProjectFolder(root, folder, [])).map((entry) => ({
            kind: entry.kind,
            name: entry.name,
            path: entry.path,
          }))
          expect(actual).toEqual([...sorted("folder"), ...sorted("file")])
        }
      }),
    ),
    { numRuns: 50 },
  )
})

test("R3: opening a folder then ../ restores the listing and highlights the folder left", async () => {
  // R3: Opening a folder and then selecting ../ shows the same entries as before, with the folder just left highlighted.
  // Kind: round-trip. In random projects, every folder at every depth is opened and left again through the ../ row.
  const names = await usableNames(projectNames)
  await fc.assert(
    fc.asyncProperty(projectSpec(names), (spec) =>
      withProject(spec, async (root) => {
        const folders = [[], ...flatten(spec).filter((entry) => entry.kind === "folder").map((entry) => entry.path)]
        for (const folder of folders) {
          const before = await listProjectFolder(root, folder)
          for (const child of before.filter((entry) => entry.openable)) {
            const up = structureNavigationRows(child.path).find((row) => row.title === "../")
            expect(up?.path).toEqual(folder)
            const after = await listProjectFolder(root, up!.path)
            expect(after).toEqual(before)
            expect(structureHighlightAfterMove(child.path, up!.path)).toEqual(child.path)
          }
        }
      }),
    ),
    { numRuns: 30 },
  )
})

test("R4: a root shortcut appears exactly when two or more levels deep", () => {
  // R4: At 2+ levels deep, the list shows ../ and "Back to project root". At 1 level deep, only ../ ("Up to project
  // root"). Folders open at any depth.
  // Kind: invariant. Folder paths range from the root (length 0) to 8 levels deep, covering the 1-to-2 boundary
  // and depths past the old 2-level limit.
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...projectNames), { maxLength: 8 }), (folder) => {
      const rows = structureNavigationRows(folder)
      expect(rows.map((row) => row.title)).toEqual(
        folder.length === 0 ? [] : folder.length === 1 ? ["../"] : ["../", "Back to project root"],
      )
      expect(rows.slice(0, 1).map((row) => row.path)).toEqual(folder.length ? [folder.slice(0, -1)] : [])
      if (folder.length === 1) expect(rows[0].description).toBe("Up to project root")
      const root = rows.find((row) => row.title === "Back to project root")
      if (root) expect(root.path).toEqual([])
    }),
    { numRuns: 300 },
  )
})

test("R7: only known names get a purpose label, matched case-insensitively", () => {
  // R7: A purpose comment appears only for names in the known-name list (case-insensitive). Other names get none.
  // Kind: invariant. Names come from three pools: every known name with randomly flipped letter case,
  // names that exist on every JS object (`constructor`, `__proto__`, ...), and arbitrary strings.
  const knownName = fc
    .tuple(
      fc.constantFrom(...Object.keys(knownDirectoryPurposes), ...Object.keys(knownFilePurposes)),
      fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
    )
    .map(([name, upper]) => [...name].map((char, i) => (upper[i] ? char.toUpperCase() : char)).join(""))
  const objectKey = fc.constantFrom("constructor", "toString", "valueOf", "hasOwnProperty", "__proto__")
  fc.assert(
    fc.property(
      fc.oneof(knownName, objectKey, fc.string({ minLength: 1 })),
      fc.constantFrom("folder" as const, "file" as const),
      (name, kind) => {
        // Object.fromEntries defines `name` as an own key even for `__proto__`, like a real scanned entry should be.
        const tree: ProjectTree = Object.fromEntries([[name, kind === "folder" ? {} : null]])
        const table = kind === "folder" ? knownDirectoryPurposes : knownFilePurposes
        const key = name.toLowerCase()
        const expected = Object.hasOwn(table, key) ? table[key] : undefined
        expect(listStructureLevel(tree)).toEqual([expect.objectContaining({ name, kind, purpose: expected })])
      },
    ),
    { numRuns: 500 },
  )
})

test("R8: adding nested files never changes the root listing", async () => {
  // R8: Adding files inside existing folders never changes the root listing. Opening the view reads only the root.
  // Kind: metamorphic. Record the root listing of a random project, add files at random depths (creating new
  // folders too) inside its top-level folders, and compare. Added names use their own prefixes so they never
  // collide with existing files.
  const added = (prefix: string, suffix = "") => fc.integer({ min: 0, max: 3 }).map((n) => `${prefix}-${n}${suffix}`)
  const names = await usableNames(projectNames)
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.constantFrom("src", "docs", "test", "Packages", "my-stuff"), { minLength: 1, maxLength: 4 }),
      fc.array(projectSpec(names), { minLength: 4, maxLength: 4 }),
      fc.array(
        fc.record({ top: fc.nat(), dirs: fc.array(added("nd"), { maxLength: 6 }), file: added("nf", ".ts") }),
        { minLength: 1, maxLength: 10 },
      ),
      (tops, contents, additions) =>
        withProject(Object.fromEntries(tops.map((top, i) => [top, contents[i]])), async (root) => {
          const before = await listProjectFolder(root)
          for (const add of additions)
            await Bun.write(path.join(root, tops[add.top % tops.length], ...add.dirs, add.file), "")
          expect(await listProjectFolder(root)).toEqual(before)
        }),
    ),
    { numRuns: 30 },
  )
})

/** Everything the user can see by opening every folder, starting from the root. */
async function openEveryFolder(root: string, hidden: readonly string[], folder: string[] = []): Promise<StructureEntry[]> {
  const entries = await listProjectFolder(root, folder, hidden)
  const nested = await Promise.all(
    entries.filter((entry) => entry.openable).map((entry) => openEveryFolder(root, hidden, entry.path)),
  )
  return [...entries, ...nested.flat()]
}

async function withProject(spec: Spec, check: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-structure-relghali-"))
  try {
    await writeSpec(root, spec)
    await check(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function writeSpec(dir: string, spec: Spec): Promise<void> {
  await mkdir(dir, { recursive: true })
  await Promise.all(
    Object.entries(spec).map(([name, child]) =>
      child === null ? Bun.write(path.join(dir, name), "") : writeSpec(path.join(dir, name), child),
    ),
  )
}

function flatten(spec: Spec, parent: string[] = []): { kind: "folder" | "file"; path: string[] }[] {
  return Object.entries(spec).flatMap(([name, child]) =>
    child === null
      ? [{ kind: "file" as const, path: [...parent, name] }]
      : [{ kind: "folder" as const, path: [...parent, name] }, ...flatten(child, [...parent, name])],
  )
}

/** Drops case twins on case-insensitive file systems (e.g. macOS), where both can't exist on disk. */
async function usableNames(names: readonly string[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "project-structure-case-"))
  try {
    await Bun.write(path.join(dir, "a"), "")
    const caseSensitive = !(await stat(path.join(dir, "A")).then(
      () => true,
      () => false,
    ))
    return caseSensitive ? names : names.filter((name) => !caseTwins.includes(name))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
