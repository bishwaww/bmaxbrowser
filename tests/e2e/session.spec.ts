import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inMain, launch, sleep } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'

let server: TestServer
const dirs: string[] = []

test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
  await server.close()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function profile(): string {
  const d = mkdtempSync(join(tmpdir(), 'bmax-session-'))
  dirs.push(d)
  return d
}
const env = (userData: string): Record<string, string> => ({ BMAX_SHIELDS_OFFLINE: '1', BMAX_USER_DATA: userData })

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) {
    await sleep(150)
    v = await fn()
  }
  return v
}

test('by default nothing about open tabs is written to disk, even after quitting', async () => {
  const userData = profile()
  const h = await launch(env(userData))
  await inMain(h.app, `s.windows.focused().openTab(arg)`, `${server.origin}/b`)
  await waitFor(() => inMain<boolean>(h.app, `return !s.windows.focused().activeTab.loading`), (v) => v)
  await sleep(2200) // longer than the save debounce
  await h.app.close().catch(() => undefined)
  expect(existsSync(join(userData, 'session.json'))).toBe(false)
  const text = JSON.stringify(readFileSync(join(userData, 'settings.json'), 'utf8'))
  expect(text).not.toContain(String(server.port))
})

test('opt-in: tabs are restored after a restart; only the selected tab loads, the rest wait asleep', async () => {
  const userData = profile()
  const first = await launch(env(userData))
  await inMain(first.app, `s.settings.update({ general: { ...s.settings.get().general, restoreSession: true } })`)
  await inMain(first.app, `s.windows.focused().go(arg)`, `${server.origin}/`)
  await inMain(first.app, `s.windows.focused().openTab(arg)`, `${server.origin}/b`)
  await inMain(first.app, `const w = s.windows.focused(); const t = w.openTab(arg, { background: true }); w.setPinned(t, true)`, `${server.origin}/frame`)
  await waitFor(() => inMain<boolean>(first.app, `return s.windows.focused().tabs.every((t) => !t.loading)`), (v) => v)
  // A container tab and a Tor/isolated window must never be saved.
  await inMain(first.app, `s.windows.focused().openTab(arg, { partition: s.sessions.newContainerPartition() })`, `${server.origin}/ext-page`)
  await inMain(first.app, `s.windows.create({ isolated: true, url: arg })`, `${server.origin}/ext-page`)
  await sleep(800)
  // Select /b again so it is the active tab when we quit.
  await inMain(first.app, `s.windows.all().find((w) => !w.isolated).activate(s.windows.all().find((w) => !w.isolated).tabs.find((t) => t.url.endsWith('/b')))`)
  await sleep(300)
  await first.app.close().catch(() => undefined)

  const saved = JSON.parse(readFileSync(join(userData, 'session.json'), 'utf8')) as { windows: { tabs: { url: string; pinned: boolean }[]; active: number }[] }
  expect(saved.windows).toHaveLength(1)
  const urls = saved.windows[0]!.tabs.map((t) => t.url)
  expect(urls).toEqual([`${server.origin}/frame`, `${server.origin}/`, `${server.origin}/b`])
  expect(saved.windows[0]!.tabs.map((t) => t.pinned)).toEqual([true, false, false])
  expect(saved.windows[0]!.active).toBe(2)
  // Only addresses: no titles or page data.
  expect(Object.keys(saved.windows[0]!.tabs[0]!).sort()).toEqual(['pinned', 'url'])
  expect(JSON.stringify(saved)).not.toContain('ext-page')

  const second = await launch(env(userData))
  try {
    const state = await inMain<{ windows: number; tabs: { url: string; sleeping: boolean; pinned: boolean; active: boolean }[] }>(
      second.app,
      `const ws = s.windows.all(); const w = ws[0]; return { windows: ws.length, tabs: w.tabs.map((t) => ({ url: t.url, sleeping: t.sleeping, pinned: t.pinned, active: t === w.activeTab })) }`
    )
    expect(state.windows).toBe(1)
    expect(state.tabs.map((t) => t.url)).toEqual(urls)
    expect(state.tabs.map((t) => t.pinned)).toEqual([true, false, false])
    expect(state.tabs.map((t) => t.active)).toEqual([false, false, true])
    expect(state.tabs.map((t) => t.sleeping)).toEqual([true, true, false])
    // The selected tab really loaded; the others have not touched the network.
    expect(await waitFor(() => inMain<string>(second.app, `return s.windows.all()[0].activeTab.wc.getURL()`), (u) => u === `${server.origin}/b`)).toBe(`${server.origin}/b`)
    // Selecting a sleeping tab loads it.
    await inMain(second.app, `const w = s.windows.all()[0]; w.activate(w.tabs[1])`)
    expect(await waitFor(() => inMain<string>(second.app, `return s.windows.all()[0].activeTab.wc.getURL()`), (u) => u === `${server.origin}/`)).toBe(`${server.origin}/`)
    expect(await inMain<boolean>(second.app, `return s.windows.all()[0].tabs[1].sleeping`)).toBe(false)
    // Settings survive too.
    expect(await inMain<boolean>(second.app, `return s.settings.get().general.restoreSession`)).toBe(true)
  } finally {
    await second.app.close().catch(() => undefined)
  }
})

test('closing windows one by one keeps the last real state; turning the setting off deletes the file', async () => {
  const userData = profile()
  const h = await launch(env(userData))
  await inMain(h.app, `s.settings.update({ general: { ...s.settings.get().general, restoreSession: true } })`)
  await inMain(h.app, `s.windows.focused().go(arg)`, `${server.origin}/b`)
  await sleep(2200)
  expect(existsSync(join(userData, 'session.json'))).toBe(true)
  // Closing the last window must not overwrite the saved session with an empty one.
  await inMain(h.app, `s.windows.focused().base.close()`)
  await sleep(1000)
  await h.app.close().catch(() => undefined)
  const saved = JSON.parse(readFileSync(join(userData, 'session.json'), 'utf8')) as { windows: { tabs: { url: string }[] }[] }
  expect(saved.windows[0]!.tabs.map((t) => t.url)).toEqual([`${server.origin}/b`])

  const second = await launch(env(userData))
  try {
    expect(await inMain<string[]>(second.app, `return s.windows.all()[0].tabs.map((t) => t.url)`)).toEqual([`${server.origin}/b`])
    await inMain(second.app, `s.settings.update({ general: { ...s.settings.get().general, restoreSession: false } })`)
    await waitFor(() => Promise.resolve(existsSync(join(userData, 'session.json'))), (v) => v === false)
    expect(existsSync(join(userData, 'session.json'))).toBe(false)
  } finally {
    await second.app.close().catch(() => undefined)
  }
})

test('Burn deletes the saved session and does not save the windows it closes', async () => {
  const userData = profile()
  const h = await launch(env(userData))
  try {
    await inMain(h.app, `s.settings.update({ general: { ...s.settings.get().general, restoreSession: true } })`)
    await inMain(h.app, `s.windows.focused().go(arg)`, `${server.origin}/b`)
    await sleep(2200)
    expect(existsSync(join(userData, 'session.json'))).toBe(true)
    await inMain(h.app, `await s.windows.burn()`)
    await sleep(2500)
    expect(existsSync(join(userData, 'session.json'))).toBe(false)
  } finally {
    await h.app.close().catch(() => undefined)
  }
  expect(existsSync(join(userData, 'session.json'))).toBe(false)
})
