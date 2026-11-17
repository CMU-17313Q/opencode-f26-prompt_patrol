import { expect, test } from "bun:test"
import { assert, array, asyncProperty, constantFrom, integer, property } from "fast-check"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  listStructureLevel,
  maxStructureDepth,
  parentStructurePath,
  scanProjectTree,
  structureEntryTitle,
  structureLocation,
} from "../src/project-structure"

test("R1: the displayed location identifies the root or full project path", () => {
  // R1: The viewer must display the user's current location within the project hierarchy.
  // Kind: invariant. Generate root, one-level, and maximum supported two-level paths.
  assert(
    property(
      integer({ min: 0, max: maxStructureDepth }).chain((length) =>
        array(constantFrom("src", "packages", "models", "utils"), {
          minLength: length,
          maxLength: length,
        }),
      ),
      (folder) => {
        const location = structureLocation(folder)
        if (folder.length === 0) {
          expect(location).toBe("Project root")
          return
        }
        expect(location.endsWith("/")).toBe(true)
        expect(location.slice(0, -1).split("/")).toEqual(folder)
      },
    ),
  )
})

test("R2: rescanning shows new folders and files under their actual parent", async () => {
  // R2: Newly added folders and files must appear under their correct parent directory.
  // Kind: model/oracle. Generate safe names, add both item kinds to a real temporary parent,
  // then compare the rescan to those additions.
  await assert(
    asyncProperty(
      integer({ min: 1, max: maxStructureDepth }).chain((length) =>
        array(integer({ min: 0, max: 10000 }), {
          minLength: length,
          maxLength: length,
        }),
      ),
      integer({ min: 0, max: 10000 }),
      integer({ min: 0, max: 10000 }),
      async (parentIDs, folderID, fileID) => {
        const root = await mkdtemp(path.join(os.tmpdir(), "project-structure-property-"))
        const parent = parentIDs.map((id, index) => `parent-${index}-${id}`)
        const folder = `folder-${folderID}`
        const file = `file-${fileID}.ts`

        try {
          await mkdir(path.join(root, ...parent), { recursive: true })
          expect(listStructureLevel(await scanProjectTree(root), parent)).toEqual([])
          await mkdir(path.join(root, ...parent, folder))
          await Bun.write(path.join(root, ...parent, file), "")

          const tree = await scanProjectTree(root)
          const entries = listStructureLevel(tree, parent)
          const rootEntries = listStructureLevel(tree)
          expect(entries.some((entry) => entry.kind === "folder" && entry.name === folder)).toBe(true)
          expect(entries.some((entry) => entry.kind === "file" && entry.name === file)).toBe(true)
          expect(rootEntries.some((entry) => entry.name === folder || entry.name === file)).toBe(false)
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      },
    ),
    { numRuns: 20 },
  )
})

test("R3: navigating up one level returns the immediate parent", async () => {
  // R3: Navigating back from a folder must return the user to its immediate parent directory.
  // Kind: round-trip. Generate a project hierarchy, inspect a child level, then verify
  // returning to the parent lists the exact same entries as before opening the child.
  await assert(
    asyncProperty(
      array(constantFrom("src", "packages", "models", "utils"), { maxLength: maxStructureDepth - 1 }),
      async (parent) => {
        const childPath = [...parent, "child"]
        const child = [...childPath, "leaf.ts"].join("/")
        const sibling = [...parent, "sibling.ts"].join("/")
        const root = await mkdtemp(path.join(os.tmpdir(), "project-structure-navigation-"))

        try {
          await Bun.write(path.join(root, child), "")
          await Bun.write(path.join(root, sibling), "")
          const tree = await scanProjectTree(root)
          const before = listStructureLevel(tree, parent).map((entry) => `${entry.kind}:${entry.name}`)
          expect(listStructureLevel(tree, childPath).map((entry) => entry.name)).toEqual(["leaf.ts"])

          const returnedTo = parentStructurePath(childPath)
          expect(returnedTo).toEqual(parent)
          expect(listStructureLevel(tree, returnedTo).map((entry) => `${entry.kind}:${entry.name}`)).toEqual(before)
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      },
    ),
  )
})

test("R5: folder titles have an indicator that file titles do not", () => {
  // R5: The viewer must provide a visual indicator that distinguishes folders from regular files.
  // Kind: invariant. Generate both entry kinds and verify the folder-only trailing slash marker.
  assert(
    property(
      constantFrom("folder" as const, "file" as const),
      integer({ min: 0, max: 10000 }),
      (kind, id) => {
        const name = `entry-${id}`
        expect(structureEntryTitle({ kind, name }).endsWith("/")).toBe(kind === "folder")
      },
    ),
  )
})
