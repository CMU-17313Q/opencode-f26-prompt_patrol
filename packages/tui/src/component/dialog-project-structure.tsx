/** @jsxImportSource @opentui/solid */
import { resolve } from "node:path"
import { summarizeProjectStructure } from "@opencode-ai/script/project-structure"
import { createMemo, createResource, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"

type StructureEntry = {
  kind: "tree" | "purpose" | "status"
  text: string
}

export function DialogProjectStructure(props: { root: string }) {
  const dialog = useDialog()
  const root = resolve(props.root)
  const [listing] = createResource(async () => {
    try {
      return { summary: await summarizeProjectStructure(root), error: undefined }
    } catch (error) {
      return { summary: undefined, error: error instanceof Error ? error.message : String(error) }
    }
  })
  const options = createMemo<DialogSelectOption<StructureEntry>[]>(() => {
    const result = listing()
    if (listing.loading) {
      return [{ title: "Loading...", value: { kind: "status", text: "Loading..." }, disabled: true }]
    }
    if (result?.error) {
      return [{ title: result.error, value: { kind: "status", text: result.error }, disabled: true }]
    }

    const summary = result?.summary
    if (!summary || (!summary.tree && summary.purposeGuesses.length === 0)) {
      return [{ title: "No project files found", value: { kind: "status", text: "No project files found" }, disabled: true }]
    }

    return [
      ...summary.purposeGuesses.map((text) => ({
        title: text,
        category: "Overview",
        value: { kind: "purpose" as const, text },
      })),
      ...summary.tree.split("\n").map((text) => ({
        title: text,
        category: "Project files",
        value: { kind: "tree" as const, text },
      })),
    ]
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
