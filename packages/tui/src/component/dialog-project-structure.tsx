/** @jsxImportSource @opentui/solid */
import { resolve } from "node:path"
import {
  defaultHiddenFolders,
  listProjectFolder,
  structureEntryTitle,
  structureHighlightAfterMove,
  structureLocation,
  structureNavigationRows,
} from "@opencode-ai/script/project-structure"
import { isDeepEqual } from "remeda"
import { createEffect, createMemo, createResource, createSignal, on, onMount } from "solid-js"
import { useKV } from "../context/kv"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"

type StructureValue = { kind: "up" | "folder" | "file" | "info" | "menu" | "toggle"; path: string[] }

/** KV key for the folder names the user hides from the view (R1). Saved across restarts. */
export const hiddenFoldersKey = "project_structure_hidden_folders"

export function DialogProjectStructure(props: { root: string }) {
  const dialog = useDialog()
  const kv = useKV()
  const root = resolve(props.root)
  const [folder, setFolder] = createSignal<string[]>([])
  const [menu, setMenu] = createSignal(false)
  const hidden = createMemo<string[]>(() => kv.get(hiddenFoldersKey, [...defaultHiddenFolders]))
  // Each folder is read only when it is opened, so the view opens at any depth and stays fast on large repos.
  const [listing] = createResource(
    () => ({ folder: folder(), hidden: hidden() }),
    (input) =>
      listProjectFolder(root, input.folder, input.hidden).then(
        (entries) => ({ entries, error: undefined }),
        (error: unknown) => ({ entries: [], error: error instanceof Error ? error.message : String(error) }),
      ),
  )
  // The row to highlight once the next list is shown: the folder just left (R3), or the menu row after leaving
  // the menu. Undefined means the first row.
  let highlight: StructureValue | undefined
  let select: DialogSelectRef<StructureValue> | undefined

  const folderOptions = (): DialogSelectOption<StructureValue>[] => {
    const category = structureLocation(folder())
    const result = listing.loading ? undefined : listing()
    // Status rows have no onSelect. (DialogSelect drops `disabled` rows, so they can't be used here.)
    const info = (title: string) => [{ title, category, value: { kind: "info" as const, path: [] } }]
    return [
      ...(folder().length
        ? []
        : [
            {
              title: "Hidden folders",
              description: hidden().length ? `${hidden().length} hidden` : "showing all folders",
              category,
              value: { kind: "menu" as const, path: [] },
              onSelect: () => showMenu(true),
            },
          ]),
      ...structureNavigationRows(folder()).map((row) => ({
        title: row.title,
        description: row.description,
        category,
        value: { kind: "up" as const, path: row.path },
        onSelect: () => open(row.path),
      })),
      ...(result?.entries ?? []).map((entry) => ({
        title: structureEntryTitle(entry),
        description: entry.purpose,
        category,
        value: { kind: entry.kind, path: entry.path },
        onSelect: entry.openable ? () => open(entry.path) : undefined,
      })),
      ...(!result
        ? info("Loading...")
        : result.error
          ? info(`Could not read this folder: ${result.error}`)
          : result.entries.length
            ? []
            : info(folder().length ? "Empty folder" : "No project files found")),
    ]
  }

  // R1: one toggle per default hidden name, plus a switch that shows every folder.
  const menuOptions = (): DialogSelectOption<StructureValue>[] => {
    const category = "Hidden folders"
    const showAll = hidden().length === 0
    const check = (on: boolean) => (on ? "[x]" : "[ ]")
    return [
      {
        title: "../",
        description: "Back to project structure",
        category,
        value: { kind: "up", path: [] },
        onSelect: () => showMenu(false),
      },
      {
        title: `${check(showAll)} Show all folders`,
        category,
        value: { kind: "toggle", path: [] },
        onSelect: () => kv.set(hiddenFoldersKey, showAll ? [...defaultHiddenFolders] : []),
      },
      ...defaultHiddenFolders.map((name) => ({
        title: `${check(hidden().includes(name))} Hide ${name}/`,
        category,
        value: { kind: "toggle" as const, path: [name] },
        onSelect: () =>
          kv.set(
            hiddenFoldersKey,
            defaultHiddenFolders.filter((other) => (other === name ? !hidden().includes(name) : hidden().includes(other))),
          ),
      })),
    ]
  }

  const options = createMemo(() => (menu() ? menuOptions() : folderOptions()))

  // Keep one list and move the highlight explicitly, instead of remounting it: a remounted list would receive
  // the same Enter keypress and immediately select its own first row.
  function open(path: string[]) {
    const left = structureHighlightAfterMove(folder(), path)
    highlight = left ? { kind: "folder", path: left } : undefined
    setFolder(path)
  }

  function showMenu(show: boolean) {
    highlight = show ? undefined : { kind: "menu", path: [] }
    setMenu(show)
    moveToHighlight()
  }

  function moveToHighlight() {
    const target = options().find((option) => isDeepEqual(option.value, highlight)) ?? options()[0]
    if (target) select?.moveTo(target.value)
  }

  // A folder's entries arrive asynchronously, so the highlight moves once they have loaded.
  createEffect(
    on(
      () => (listing.loading ? undefined : listing()),
      (result) => {
        if (result && !menu()) moveToHighlight()
      },
    ),
  )

  onMount(() => dialog.setSize("large"))

  return (
    <DialogSelect
      title="Project structure"
      footer={<text>{root}</text>}
      renderFilter={false}
      ref={(ref) => (select = ref)}
      options={options()}
    />
  )
}
