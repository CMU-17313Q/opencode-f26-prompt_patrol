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
        expect(structureLocation(folder)).toBe(folder.length ? `${folder.join("/")}/` : "Project root")
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
      integer({ min: 0, max: 10000 }),
      integer({ min: 0, max: 10000 }),
      integer({ min: 0, max: 10000 }),
      async (parentID, folderID, fileID) => {
        const root = await mkdtemp(path.join(os.tmpdir(), "project-structure-property-"))
        const parent = `parent-${parentID}`
        const folder = `folder-${folderID}`
        const file = `file-${fileID}.ts`

        try {
          await mkdir(path.join(root, parent), { recursive: true })
          expect(listStructureLevel(await scanProjectTree(root), [parent])).toEqual([])
          await mkdir(path.join(root, parent, folder))
          await Bun.write(path.join(root, parent, file), "")

          const entries = listStructureLevel(await scanProjectTree(root), [parent])
          expect(entries.some((entry) => entry.kind === "folder" && entry.name === folder)).toBe(true)
          expect(entries.some((entry) => entry.kind === "file" && entry.name === file)).toBe(true)
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      },
    ),
  )
})

test("R3: navigating up one level returns the immediate parent", () => {
  // R3: Navigating back from a folder must return the user to its immediate parent directory.
  // Kind: round-trip. Generate a root or one-level parent, descend once, then verify
  // one back-navigation restores it.
  assert(
    property(
      array(constantFrom("src", "packages", "models", "utils"), { maxLength: maxStructureDepth - 1 }),
      (parent) => {
        const child = [...parent, "child"]
        expect(parentStructurePath(child)).toEqual(parent)
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
        expect(structureEntryTitle({ kind, name })).toBe(kind === "folder" ? `${name}/` : name)
      },
    ),
  )
})
