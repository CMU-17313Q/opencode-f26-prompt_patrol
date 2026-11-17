/** @jsxImportSource @opentui/solid */
import { resolve } from "node:path"
import {
  listStructureLevel,
  maxStructureDepth,
  parentStructurePath,
  scanProjectTree,
  structureEntryDescription,
  structureEntryTitle,
  structureLocation,
  unreadableProjectTreeDirectories,
} from "@opencode-ai/script/project-structure"
import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"

type StructureValue = { kind: "up" | "folder" | "file"; path: string[] }

export function DialogProjectStructure(props: { root: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const root = resolve(props.root)
  const [folder, setFolder] = createSignal<string[]>([])
  let select: DialogSelectRef<StructureValue> | undefined
  const [listing] = createResource(async () => {
    try {
      return { tree: await scanProjectTree(root), error: undefined }
    } catch (error) {
      return { tree: undefined, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const entries = createMemo(() => {
    const tree = listing()?.tree
    return tree ? listStructureLevel(tree, folder()) : []
  })
  const unreadable = createMemo(() => {
    const tree = listing()?.tree
    return tree ? unreadableProjectTreeDirectories(tree) : []
  })
  const status = createMemo(() => {
    if (listing.loading) return "Loading..."
    if (listing()?.error) return listing()?.error
    if (entries().length === 0) return "No project files found"
  })
  const options = createMemo<DialogSelectOption<StructureValue>[]>(() => {
    const category = structureLocation(folder())
    const up = parentStructurePath(folder())
    return [
      ...(folder().length
        ? [
            {
              title: "../",
              description: up.length ? `Back to ${up.join("/")}/` : "Back to project root",
              category,
              value: { kind: "up" as const, path: up },
              onSelect: () => open(up),
            },
          ]
        : []),
      ...entries().map((entry) => ({
        title: structureEntryTitle(entry),
        description: structureEntryDescription(entry),
        category,
        value: { kind: entry.kind, path: entry.path },
        onSelect: entry.openable ? () => open(entry.path) : undefined,
      })),
    ]
  })

  // Keep one list and move the highlight back to the first row, instead of remounting it: a remounted
  // list would receive the same Enter keypress and immediately select its own first row (`../`).
  function open(path: string[]) {
    setFolder(path)
    const first = options()[0]
    if (first) select?.moveTo(first.value)
  }

  onMount(() => dialog.setSize("large"))

  return (
    <DialogSelect
      title="Project structure"
      footer={
        <text>
          {root} - folders open up to {maxStructureDepth} levels deep
          {unreadable().length ? `; could not read: ${unreadable().join(", ")}` : ""}
        </text>
      }
      renderFilter={false}
      ref={(ref) => (select = ref)}
      emptyView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>{status()}</text>
        </box>
      }
      options={status() ? [] : options()}
    />
  )
}
