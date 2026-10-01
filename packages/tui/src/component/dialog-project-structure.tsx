/** @jsxImportSource @opentui/solid */
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { createMemo, createResource, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"

type StructureEntry = {
  kind: "directory" | "file" | "status"
  name: string
}

export function DialogProjectStructure(props: { root: string }) {
  const dialog = useDialog()
  const root = resolve(props.root)
  const [listing] = createResource(async () => {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      return {
        entries: entries
          .filter((entry) => entry.isDirectory() || entry.isFile())
          .map((entry) => ({
            kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
            name: entry.name,
          }))
          .sort(
            (left, right) =>
              Number(right.kind === "directory") - Number(left.kind === "directory") ||
              left.name.localeCompare(right.name),
          ),
        error: undefined,
      }
    } catch (error) {
      return { entries: [], error: error instanceof Error ? error.message : String(error) }
    }
  })
  const options = createMemo<DialogSelectOption<StructureEntry>[]>(() => {
    const result = listing()
    if (listing.loading) {
      return [{ title: "Loading...", value: { kind: "status", name: "Loading..." }, disabled: true }]
    }
    if (result?.error) {
      return [{ title: result.error, value: { kind: "status", name: result.error }, disabled: true }]
    }

    return (result?.entries ?? []).map((entry) => ({
      title: entry.kind === "directory" ? `${entry.name}/` : entry.name,
      category: entry.kind === "directory" ? "Folders" : "Files",
      value: entry,
    }))
  })

  onMount(() => dialog.setSize("large"))

  return (
    <DialogSelect
      title="Project structure"
      footer={<text>{root}</text>}
      locked
      renderFilter={false}
      options={options()}
    />
  )
}
