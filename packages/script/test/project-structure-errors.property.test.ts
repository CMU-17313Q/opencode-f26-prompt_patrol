import { expect, test } from "bun:test"
import {
  array,
  assert,
  asyncProperty,
  boolean,
  constantFrom,
  oneof,
  property,
  stringMatching,
  subarray,
} from "fast-check"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  knownDirectoryPurposes,
  knownFilePurposes,
  listStructureLevel,
  scanProjectTree,
  structureEntryDescription,
  type ProjectTree,
} from "../src/project-structure"

// Names that look like real project entries, kept short so shrunk counterexamples stay readable.
const plainName = stringMatching(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,11}$/)

// Names that are easy to get wrong: properties every JavaScript object inherits, and near-misses of
// known folder names that an interviewee might expect to be recognized (C-8: src renamed to source).
const trickyName = constantFrom(
  "constructor",
  "__proto__",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "source",
  "srcs",
  "test2",
  "my-stuff",
  "xyz",
)

const knownName = constantFrom(...Object.keys(knownDirectoryPurposes), ...Object.keys(knownFilePurposes))

const isKnown = (name: string) =>
  Object.hasOwn(knownDirectoryPurposes, name.toLowerCase()) || Object.hasOwn(knownFilePurposes, name.toLowerCase())

const unknownName = oneof(plainName, trickyName).filter((name) => !isKnown(name))

const entryKind = constantFrom("folder" as const, "file" as const)

// Object.fromEntries creates own keys even for "__proto__", the same way a folder on disk is a real name.
const treeOf = (entries: readonly (readonly [string, "folder" | "file"])[]): ProjectTree =>
  Object.fromEntries(entries.map(([name, kind]) => [name, kind === "folder" ? {} : null]))

const rows = (tree: ProjectTree, folder: string[] = []) =>
  listStructureLevel(tree, folder).map((entry) => ({ ...entry, description: structureEntryDescription(entry) }))

async function withTempProject<T>(run: (root: string) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-structure-errors-"))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("R1: a file that is added and then deleted is gone when the tree is reopened", async () => {
  // R1: Deleted files don't show up when the tree is reopened.
  // Kind: round-trip. Adding a file and then deleting it must give back the same tree as before.
  // Generators: a small existing project (known and random names), and a new file that is either a
  // random name or a tricky one (.env, constructor, __proto__), placed at the root or inside src/.
  // Names are compared case-insensitively so the test also works on case-insensitive filesystems.
  await assert(
    asyncProperty(
      array(oneof(knownName, plainName), { maxLength: 5 }),
      oneof(plainName, trickyName, constantFrom("notes.txt", ".env", "README.md")),
      boolean(),
      async (existing, added, insideSrc) => {
        const folder = insideSrc ? ["src"] : []
        const taken = new Set([...existing, "src"].map((name) => name.toLowerCase()))
        if (taken.has(added.toLowerCase()) || [".", ".."].includes(added)) return

        await withTempProject(async (root) => {
          await mkdir(path.join(root, "src"))
          await Promise.all(
            [...taken].filter((name) => name !== "src").map((name) => Bun.write(path.join(root, ...folder, name), "")),
          )
          const before = rows(await scanProjectTree(root), folder)

          const file = path.join(root, ...folder, added)
          await Bun.write(file, "")
          expect(rows(await scanProjectTree(root), folder).map((entry) => entry.name)).toContain(added)

          await rm(file)
          expect(rows(await scanProjectTree(root), folder)).toEqual(before)
        })
      },
    ),
    { numRuns: 40 },
  )
})

test("R2: folders and files with names it doesn't know get no purpose", () => {
  // R2: Folders and files with names it doesn't know get no purpose.
  // Kind: invariant. For every unknown name, of either kind, the row has no purpose and no gray
  // text, while a known src/ next to it still gets one.
  // Generators: random file-like names plus names that clash with built-in JavaScript object
  // properties (constructor, __proto__), which a plain object lookup can mistake for known names.
  assert(
    property(unknownName, entryKind, (name, kind) => {
      const unknown = rows(
        treeOf([
          [name, kind],
          ["src", "folder"],
        ]),
      ).find((entry) => entry.name === name)
      expect(unknown?.purpose).toBeUndefined()
      expect(unknown?.description).toBeUndefined()
      expect(rows(treeOf([["src", "folder"]]))[0]?.purpose).toBe("main application code")
    }),
    { examples: [["constructor", "folder"]] },
  )
})

test("R3: every purpose the viewer shows is labeled as a guess", () => {
  // R3: Purposes are labeled as guesses.
  // Kind: invariant. Every row with a purpose shows "likely: <purpose>", and rows without one show nothing.
  // Generators: a folder mixing known names (both kinds) with unknown ones.
  assert(
    property(
      array(oneof(knownName, unknownName), { maxLength: 8 }),
      array(entryKind, { minLength: 8, maxLength: 8 }),
      (names, kinds) => {
        rows(treeOf(names.map((name, index) => [name, kinds[index]!]))).forEach((entry) => {
          expect(entry.description).toBe(entry.purpose === undefined ? undefined : `likely: ${entry.purpose}`)
        })
      },
    ),
  )
})

test("R4: changing a folder's capitals keeps its guess, and renaming it leaves other rows unchanged", () => {
  // R4: Changing only a folder's capitals keeps its guess. Any other rename changes only that folder's row.
  // Kind: metamorphic. Two input changes with known effects on the output:
  //   recasing a known folder name -> its purpose stays the same;
  //   renaming any folder -> every other row in the listing stays exactly the same.
  // Generators: a known folder name with random letters flipped to upper case, siblings drawn from
  // known and unknown names, and a new name that can be known, unknown, or tricky.
  assert(
    property(
      constantFrom(...Object.keys(knownDirectoryPurposes)),
      array(boolean(), { minLength: 16, maxLength: 16 }),
      array(oneof(knownName, unknownName), { maxLength: 6 }),
      oneof(knownName, unknownName),
      (name, upper, siblingNames, renamed) => {
        const recased = [...name].map((char, index) => (upper[index] ? char.toUpperCase() : char)).join("")
        const siblings = siblingNames
          .filter((sibling) => ![name, recased, renamed].includes(sibling))
          .map((sibling) => [sibling, "file"] as const)

        const original = rows(treeOf([[name, "folder"], ...siblings]))
        const afterRecase = rows(treeOf([[recased, "folder"], ...siblings]))
        expect(afterRecase.find((entry) => entry.name === recased)?.purpose).toBe(
          original.find((entry) => entry.name === name)?.purpose,
        )

        const afterRename = rows(treeOf([[renamed, "folder"], ...siblings]))
        expect(afterRename.filter((entry) => entry.name !== renamed)).toEqual(
          original.filter((entry) => entry.name !== name),
        )
      },
    ),
  )
})

test("R5: a project with only ignored folders lists nothing, so the viewer shows its empty message", async () => {
  // R5: An empty project shows a message instead of a blank list.
  // Kind: invariant. Any project made only of ignored folders (node_modules, .git, build output),
  // even when they contain files, scans to an empty listing; the dialog shows "No project files
  // found" for an empty listing (covered by test/component/dialog-project-structure.test.tsx in tui).
  // Generators: any non-empty mix of the ignored folder names, each holding random files.
  await assert(
    asyncProperty(
      subarray(["node_modules", ".git", "dist", "build", "out", ".turbo", ".cache", "coverage"], { minLength: 1 }),
      array(plainName, { minLength: 1, maxLength: 3 }),
      async (ignored, files) => {
        await withTempProject(async (root) => {
          await Promise.all(
            ignored.flatMap((folder) =>
              files.map((file) => Bun.write(path.join(root, folder, `${file.toLowerCase()}.txt`), "")),
            ),
          )
          expect(listStructureLevel(await scanProjectTree(root))).toEqual([])
        })
      },
    ),
    { numRuns: 25 },
  )
})

test("R6: a project folder that can't be found gives a short message, not a raw error", async () => {
  // R6: If the project folder can't be found when the viewer opens, it shows "Folder not found: <path>",
  // not a raw error. The dialog shows the scan error's message as-is.
  // Kind: invariant. For every missing folder, the error message is exactly "Folder not found: <path>"
  // and never mentions ENOENT, ENOTDIR, or scandir.
  // Generators: a folder that never existed (one to three random path parts), a folder that existed
  // and was deleted before scanning (the case a user can actually hit), and a path that is a file.
  await assert(
    asyncProperty(
      array(plainName, { minLength: 1, maxLength: 3 }),
      constantFrom("never existed" as const, "deleted" as const, "is a file" as const),
      async (parts, how) => {
        await withTempProject(async (root) => {
          const missing = path.join(root, ...parts)
          if (how === "deleted") {
            await mkdir(missing, { recursive: true })
            await rm(missing, { recursive: true })
          }
          if (how === "is a file") await Bun.write(missing, "")

          const message = await scanProjectTree(missing).then(
            () => "scan succeeded",
            (error: Error) => error.message,
          )
          expect(message).toBe(`Folder not found: ${missing}`)
          expect(message).not.toMatch(/ENOENT|ENOTDIR|scandir/)
        })
      },
    ),
    { numRuns: 25 },
  )
})
