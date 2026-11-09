import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export interface Harness {
  app: ElectronApplication
  userData: string
  close(): Promise<void>
}

export async function launch(extraEnv: Record<string, string> = {}, extraArgs: string[] = []): Promise<Harness> {
  const userData = mkdtempSync(join(tmpdir(), 'bmax-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), ...extraArgs],
    env: { ...(process.env as Record<string, string>), BMAX_TEST: '1', BMAX_USER_DATA: userData, ...extraEnv }
  })
  const logs: string[] = []
  app.process().stdout?.on('data', (d) => logs.push(String(d)))
  app.process().stderr?.on('data', (d) => logs.push(String(d)))
  // Wait for the first window's chrome UI to be ready. (Re-read the hook every iteration: it only exists once the app is ready.)
  await app
    .evaluate(async () => {
      type Win = { chromeView: { webContents: { isLoading(): boolean } }; tabs: unknown[] }
      const hook = (): { windows?: { focused?: () => Win | null } } | undefined =>
        (globalThis as unknown as { __bmax?: { windows?: { focused?: () => Win | null } } }).__bmax
      for (let i = 0; i < 300; i++) {
        const w = hook()?.windows?.focused?.()
        if (w && !w.chromeView.webContents.isLoading() && w.tabs.length > 0) return
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error('window did not become ready')
    })
    .catch((err) => {
      throw new Error(`${String(err)}\n--- app output ---\n${logs.join('')}`)
    })
  return {
    app,
    userData,
    async close() {
      await app.close().catch(() => undefined)
      rmSync(userData, { recursive: true, force: true })
    }
  }
}

/** Run a function in the main process with the BMAX services object. */
export async function inMain<T>(app: ElectronApplication, fn: string, arg?: unknown): Promise<T> {
  return app.evaluate(
    async (_electron, { fn, arg }) => {
      const s = (globalThis as unknown as { __bmax: unknown }).__bmax
      return await (new Function('s', 'arg', `return (async () => { ${fn} })()`) as (s: unknown, a: unknown) => Promise<unknown>)(s, arg)
    },
    { fn, arg }
  ) as Promise<T>
}

export async function screenshot(app: ElectronApplication, target: string, file: string): Promise<void> {
  const dir = resolve(__dirname, '../../test-results/shots')
  mkdirSync(dir, { recursive: true })
  const code = [
    'const w = s.windows.focused();',
    'let wc;',
    "if (arg.target === 'chrome') wc = w.chromeView.webContents;",
    "else if (arg.target === 'tab') wc = w.activeTab.wc;",
    "else wc = w.overlays.entries.get(arg.target.split(':')[1]).view.webContents;",
    'const img = await wc.capturePage();',
    "process.getBuiltinModule('node:fs').writeFileSync(arg.path, img.toPNG());"
  ].join('\n')
  await inMain<void>(app, code, { target, path: resolve(dir, file) })
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
