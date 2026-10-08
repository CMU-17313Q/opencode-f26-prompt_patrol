/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
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
  await Bun.write(path.join(state, "kv.json"), "{}")

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

test("project structure dialog opens folders level by level and stops at the depth limit", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "project/README.md"), "# demo")
  await Bun.write(path.join(tmp.path, "project/src/index.ts"), "")
  await Bun.write(path.join(tmp.path, "project/src/utils/format.ts"), "")
  await Bun.write(path.join(tmp.path, "project/src/utils/deep/leaf.ts"), "")
  await Bun.write(path.join(tmp.path, "project/docs/guide.md"), "")
  const view = await mountStructure(tmp.path)

  try {
    // Level 0: top level only, nothing nested yet.
    const top = await view.waitFor("README.md")
    expect(top).toContain("docs/")
    expect(top).toContain("src/")
    expect(top).not.toContain("utils/")
    expect(top).not.toContain("index.ts")

    // Level 1: first row is docs/, move to src/ and open it.
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const level1 = await view.waitFor("index.ts")
    expect(level1).toContain("../")
    expect(level1).toContain("utils/")
    expect(level1).not.toContain("README.md")

    // Level 2: ../ is first, then utils/ (folders first), open utils/.
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const level2 = await view.waitFor("format.ts")
    expect(level2).toContain("deep/")

    // deep/ is at the depth limit: selecting it must not navigate.
    view.app.mockInput.pressArrow("down")
    view.app.mockInput.pressEnter()
    const stillLevel2 = await view.frame()
    expect(stillLevel2).toContain("format.ts")
    expect(stillLevel2).not.toContain("leaf.ts")

    // ../ goes back up one level to src/.
    view.app.mockInput.pressArrow("up")
    view.app.mockInput.pressEnter()
    const back = await view.waitFor("index.ts")
    expect(back).not.toContain("format.ts")
  } finally {
    view.cleanup()
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
