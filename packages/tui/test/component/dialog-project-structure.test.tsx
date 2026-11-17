/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountStructure(root: string) {
  const state = path.join(root, "state-dir")
  await mkdir(state, { recursive: true })
  // Keep saved settings between mounts in the same temp dir, so a remount acts like a restart (R1).
  if (!(await Bun.file(path.join(state, "kv.json")).exists())) await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogProvider, useDialog },
    { DialogProjectStructure },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../src/ui/dialog"),
    import("../../src/component/dialog-project-structure"),
    import("../../src/context/kv"),
    import("../../src/context/theme"),
    import("../../src/config"),
    import("../../src/ui/toast"),
    import("../../src/keymap"),
  ])

  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogProjectStructure root={path.join(root, "project")} />))
    return <box />
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ keybinds: {}, leader_timeout: 1000 })
    onCleanup(registerOpencodeKeymap(keymap, renderer, resolvedConfig))

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <Open />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true, width: 100, height: 40 })
  return {
    app,
    async frame() {
      await app.renderOnce()
      return app.captureCharFrame()
    },
    async waitFor(text: string) {
      await wait(() => {
        app.renderOnce()
        return app.captureCharFrame().includes(text)
      })
      return app.captureCharFrame()
    },
    cleanup() {
      app.renderer.destroy()
    },
  }
}

test("project structure dialog opens folders level by level at any depth", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "project/README.md"), "# demo")
  await Bun.write(path.join(tmp.path, "project/src/index.ts"), "")
  await Bun.write(path.join(tmp.path, "project/src/utils/format.ts"), "")
  await Bun.write(path.join(tmp.path, "project/src/utils/deep/leaf.ts"), "")
  await Bun.write(path.join(tmp.path, "project/docs/guide.md"), "")
  await mkdir(path.join(tmp.path, "project/zz-empty"))
  const view = await mountStructure(tmp.path)

  try {
    // Level 0: top level only, nothing nested yet. Rows: Hidden folders, docs/, src/, zz-empty/, README.md.
    const top = await view.waitFor("README.md")
    expect(top).toContain("Hidden folders")
    expect(top).toContain("docs/")
    expect(top).toContain("src/")
    expect(top).toContain("zz-empty/")
    expect(top).toContain("Project root")
    expect(top).not.toContain("README.md/")
    expect(top).not.toContain("utils/")
    expect(top).not.toContain("index.ts")

    // Level 1: open src/. Rows: ../, utils/, index.ts.
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const level1 = await view.waitFor("index.ts")
    expect(level1).toContain("../")
    expect(level1).toContain("utils/")
    expect(level1).not.toContain("index.ts/")
    expect(level1).not.toContain("README.md")

    // Level 2: open utils/. Rows: ../, Back to project root, deep/, format.ts.
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const level2 = await view.waitFor("format.ts")
    expect(level2).toContain("deep/")

    // Level 3: deep/ opens too (no depth limit, R4).
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const level3 = await view.waitFor("leaf.ts")
    expect(level3).not.toContain("format.ts")

    // ../ goes back up one level to utils/.
    view.app.mockInput.pressEnter()
    const back = await view.waitFor("format.ts")
    expect(back).toContain("deep/")
    expect(back).not.toContain("leaf.ts")
  } finally {
    view.cleanup()
  }
})

test("R3: going back with ../ highlights the folder just left", async () => {
  // R3: Opening a folder and then selecting ../ shows the same entries as before, with the folder just left
  // highlighted. The highlight is checked through Enter: it must reopen src/, not another row.
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "project/README.md"), "# demo")
  await Bun.write(path.join(tmp.path, "project/docs/guide.md"), "")
  await Bun.write(path.join(tmp.path, "project/src/index.ts"), "")
  const view = await mountStructure(tmp.path)

  try {
    const top = await view.waitFor("README.md")
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    await view.waitFor("index.ts")

    // Opening a folder highlights its first row, ../
    view.app.mockInput.pressEnter()
    expect(await view.waitFor("README.md")).toBe(top)

    view.app.mockInput.pressEnter()
    const reopened = await view.waitFor("../")
    expect(reopened).toContain("index.ts")
    expect(reopened).not.toContain("guide.md")
  } finally {
    view.cleanup()
  }
})

test("R4: Back to project root appears two levels deep and opens the root", async () => {
  // R4: At 2+ levels deep, the list shows ../ and "Back to project root". At 1 level deep, only ../ ("Up to
  // project root").
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "project/README.md"), "# demo")
  await Bun.write(path.join(tmp.path, "project/packages/tui/index.ts"), "")
  const view = await mountStructure(tmp.path)

  try {
    await view.waitFor("README.md")
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const oneDeep = await view.waitFor("tui/")
    expect(oneDeep).toContain("Up to project root")
    expect(oneDeep).not.toContain("Back to project root")

    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const twoDeep = await view.waitFor("index.ts")
    expect(twoDeep).toContain("../")
    expect(twoDeep).toContain("Back to project root")

    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const root = await view.waitFor("README.md")
    expect(root).toContain("packages/")
    expect(root).not.toContain("index.ts")
  } finally {
    view.cleanup()
  }
})

test("R1: the Hidden folders menu shows hidden folders and the choice survives a restart", async () => {
  // R1: By default node_modules and the other build/VCS folders are hidden. A "Hidden folders" menu lets the user
  // toggle each name or "Show all folders". The choice is saved across restarts.
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "project/node_modules/x.js"), "")
  await Bun.write(path.join(tmp.path, "project/src/index.ts"), "")
  const first = await mountStructure(tmp.path)

  try {
    const top = await first.waitFor("src/")
    expect(top).toContain("8 hidden")
    expect(top).not.toContain("node_modules/")

    // Hidden folders is the first row; open it and turn on "Show all folders".
    first.app.mockInput.pressEnter()
    await first.waitFor("Show all folders")
    first.app.mockInput.pressArrow("down")
    first.app.mockInput.pressEnter()
    await first.waitFor("[x] Show all folders")

    // ../ goes back to the structure view, which now lists node_modules/.
    first.app.mockInput.pressArrow("up")
    first.app.mockInput.pressEnter()
    expect(await first.waitFor("node_modules/")).toContain("showing all folders")
    await wait(() =>
      readFileSync(path.join(tmp.path, "state-dir/kv.json"), "utf8").includes("project_structure_hidden_folders"),
    )
  } finally {
    first.cleanup()
  }

  // Reopening (a fresh TUI on the same saved settings) keeps the choice.
  const second = await mountStructure(tmp.path)
  try {
    expect(await second.waitFor("node_modules/")).toContain("showing all folders")
  } finally {
    second.cleanup()
  }
})

test("project structure dialog explains an empty project", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "project"), { recursive: true })
  const view = await mountStructure(tmp.path)

  try {
    expect(await view.waitFor("No project files found")).toContain("Project structure")
  } finally {
    view.cleanup()
  }
})
