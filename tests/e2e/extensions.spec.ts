import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, screenshot, sleep } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'
import { buildCrx3, buildZip } from '../helpers/zip-builder'

let h: Harness
let server: TestServer
const scratch: string[] = []

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(d)
  return d
}

const MANIFEST = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  manifest_version: 3,
  name: 'Test Marker',
  version: '1.0.3',
  description: 'Marks pages it runs on',
  content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['marker.js'], run_at: 'document_start' }],
  options_page: 'options.html',
  action: { default_popup: 'popup.html' },
  permissions: ['storage'],
  ...over
})
const FILES: Record<string, string> = {
  'marker.js': "document.documentElement.setAttribute('data-bmax-ext', 'on')",
  'options.html': '<!doctype html><title>Ext Options</title><body><script src="options.js"></script></body>',
  'options.js': "document.title = 'options:' + (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().name : 'no-api')",
  'popup.html': '<!doctype html><title>Ext Popup</title><body>popup</body>'
}

function writeExtension(dir: string, manifest: Record<string, unknown> = MANIFEST(), files: Record<string, string> = FILES): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
}

test.beforeAll(async () => {
  server = await startServer()
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1' })
})
test.afterAll(async () => {
  await h.close()
  await server.close()
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

const settingsPage = (): Page | undefined => h.app.windows().find((p) => p.url().startsWith('bmax://settings'))
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) {
    await sleep(150)
    v = await fn()
  }
  return v
}

/** Open a window with extensions and return an expression for it. */
async function openExtWindow(app: ElectronApplication): Promise<string> {
  await inMain(app, 'await s.windows.createExtensionWindow()')
  const expr = `s.windows.all().find((w) => w.extensions)`
  await waitFor(() => inMain<boolean>(app, `const w = ${expr}; return !!w && w.tabs.length > 0`), (v) => v)
  return expr
}
async function closeExtWindows(app: ElectronApplication): Promise<void> {
  await inMain(app, `for (const w of s.windows.all().filter((w) => w.extensions)) w.base.close()`)
  await waitFor(() => inMain<boolean>(app, `return !s.windows.all().some((w) => w.extensions)`), (v) => v)
}
async function load(app: ElectronApplication, winExpr: string, url: string): Promise<void> {
  await inMain(app, `${winExpr}.go(arg)`, url)
  await sleep(200)
  await waitFor(() => inMain<boolean>(app, `const t = ${winExpr}.activeTab; return !t.loading && t.wc.getURL() !== ''`), (v) => v)
  await sleep(300)
}
const marker = (app: ElectronApplication, winExpr: string): Promise<string | null> =>
  inMain<string | null>(app, `return await ${winExpr}.activeTab.wc.executeJavaScript("document.documentElement.getAttribute('data-bmax-ext')")`)
const NORMAL = 's.windows.all().find((w) => !w.extensions && !w.isolated && !w.tor)'

test('declining the install dialog installs nothing', async () => {
  const dir = tmp('bmax-ext-src-')
  writeExtension(dir)
  const r = await inMain<{ ok: boolean; message?: string }>(h.app, `return await s.extensions.installFrom(arg, async () => false)`, dir)
  expect(r.ok).toBe(false)
  expect(await inMain<unknown[]>(h.app, 'return s.extensions.list()')).toEqual([])
})

test('an unpacked extension installs and shows what it can access', async () => {
  const dir = tmp('bmax-ext-src-')
  writeExtension(dir)
  const seen = await inMain<{ name: string; permissions: string[]; allSites: boolean; ok: boolean }>(
    h.app,
    `let summary; const r = await s.extensions.installFrom(arg, async (sum) => { summary = sum; return true }); return { ...summary, ok: r.ok, message: r.message }`,
    dir
  )
  expect(seen.ok).toBe(true)
  expect(seen.name).toBe('Test Marker')
  expect(seen.allSites).toBe(false)
  expect(seen.permissions.join('|')).toContain('127.0.0.1')
  const list = await inMain<{ id: string; name: string; enabled: boolean; error?: string }[]>(h.app, 'return s.extensions.list()')
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ name: 'Test Marker', enabled: true })
  expect(list[0]!.error).toBeUndefined()
})

test('extensions run in a window with extensions only: not in normal, isolated or container tabs', async () => {
  // Normal window: nothing runs.
  await load(h.app, NORMAL, `${server.origin}/ext-page`)
  expect(await marker(h.app, NORMAL)).toBeNull()

  // Extension window: the content script runs on matching pages only.
  const ext = await openExtWindow(h.app)
  await load(h.app, ext, `${server.origin}/ext-page`)
  expect(await marker(h.app, ext)).toBe('on')
  await load(h.app, ext, `${server.alt}/b`)
  expect(await marker(h.app, ext)).toBeNull()
  // The toolbar says so.
  const chrome = h.app.windows().filter((p) => p.url().startsWith('bmax://chrome'))
  expect(await Promise.any(chrome.map(async (p) => (await p.getByText('EXT', { exact: true }).count()) > 0 || Promise.reject(new Error('no'))))).toBe(true)
  await closeExtWindows(h.app)

  // Isolated window and container tab: nothing runs.
  await inMain(h.app, `s.windows.create({ isolated: true })`)
  await waitFor(() => inMain<boolean>(h.app, `const w = s.windows.focused(); return w.isolated && !w.extensions && w.tabs.length > 0`), (v) => v)
  await load(h.app, 's.windows.focused()', `${server.origin}/ext-page`)
  expect(await marker(h.app, 's.windows.focused()')).toBeNull()
  await inMain(h.app, `s.windows.focused().base.close()`)
  await waitFor(() => inMain<boolean>(h.app, `return !s.windows.focused().isolated`), (v) => v)

  await inMain(h.app, `${NORMAL}.openTab(arg, { partition: s.sessions.newContainerPartition() })`, `${server.origin}/ext-page`)
  await waitFor(() => inMain<boolean>(h.app, `const t = ${NORMAL}.activeTab; return !t.loading && t.wc.getURL().includes('ext-page')`), (v) => v)
  await sleep(300)
  expect(await marker(h.app, NORMAL)).toBeNull()
  await inMain(h.app, `const w = ${NORMAL}; w.closeTab(w.activeTab)`)
})

test('the extension profile is temporary: site data is wiped when the window closes', async () => {
  const ext = await openExtWindow(h.app)
  await load(h.app, ext, `${server.origin}/ext-page`)
  await inMain(h.app, `return await ${ext}.activeTab.wc.executeJavaScript("localStorage.setItem('k', 'secret'); document.cookie = 'c=1; path=/'; 1")`)
  expect(await inMain<string | null>(h.app, `return await ${ext}.activeTab.wc.executeJavaScript("localStorage.getItem('k')")`)).toBe('secret')
  await closeExtWindows(h.app)
  await sleep(500)
  const ext2 = await openExtWindow(h.app)
  await load(h.app, ext2, `${server.origin}/ext-page`)
  expect(await inMain<string | null>(h.app, `return await ${ext2}.activeTab.wc.executeJavaScript("localStorage.getItem('k')")`)).toBeNull()
  expect(await inMain<string>(h.app, `return await ${ext2}.activeTab.wc.executeJavaScript("document.cookie")`)).toBe('')
  await closeExtWindows(h.app)
})

test('options page opens with the extension API; Settings lists the extension', async () => {
  const id = (await inMain<{ id: string }[]>(h.app, 'return s.extensions.list()'))[0]!.id
  const url = await inMain<string | null>(h.app, `return s.extensions.pageUrl(arg, 'options')`, id)
  expect(url).toMatch(/^chrome-extension:\/\/[a-p]{32}\/options\.html$/)
  const ext = await openExtWindow(h.app)
  await inMain(h.app, `${ext}.openTab(arg, { partition: 'persist:bmax-ext' })`, url)
  const title = await waitFor(
    () => inMain<string>(h.app, `return ${ext}.activeTab.wc.getTitle()`),
    (t) => t.startsWith('options:')
  )
  expect(title).toBe('options:Test Marker')
  // The address bar shows the extension page (not an "open external app" prompt).
  expect(await inMain<string>(h.app, `return ${ext}.activeTab.url`)).toBe(url)
  await closeExtWindows(h.app)

  await load(h.app, NORMAL, 'bmax://settings/?section=Extensions')
  const p = (await waitFor(async () => settingsPage(), (x) => !!x))!
  await p.getByRole('button', { name: 'Extensions', exact: true }).click()
  const row = p.locator('[data-extension="Test Marker"]')
  await expect(row).toBeVisible()
  await expect(row).toContainText('127.0.0.1')
  await expect(row.getByRole('button', { name: 'Open options' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Open popup' })).toBeVisible()
  await expect(p.getByRole('button', { name: 'New window with extensions' })).toBeVisible()
  await screenshot(h.app, 'tab', 'settings-extension-installed.png')
})

test('disabling stops it, enabling brings it back (from Settings)', async () => {
  const p = settingsPage()!
  const row = p.locator('[data-extension="Test Marker"]')
  await row.getByRole('switch', { name: 'Enable Test Marker' }).click()
  await waitFor(() => inMain<boolean>(h.app, `return s.extensions.list()[0].enabled`), (v) => v === false)
  let ext = await openExtWindow(h.app)
  await load(h.app, ext, `${server.origin}/ext-page`)
  expect(await marker(h.app, ext)).toBeNull()
  await closeExtWindows(h.app)

  await row.getByRole('switch', { name: 'Enable Test Marker' }).click()
  await waitFor(() => inMain<boolean>(h.app, `return s.extensions.list()[0].enabled`), (v) => v === true)
  ext = await openExtWindow(h.app)
  await load(h.app, ext, `${server.origin}/ext-page`)
  expect(await marker(h.app, ext)).toBe('on')
  await closeExtWindows(h.app)
})

test('removing deletes the extension and its files', async () => {
  const root = join(h.userData, 'extensions')
  expect(readdirSync(root).filter((n) => /^[a-p]{32}$/.test(n))).toHaveLength(1)
  const p = settingsPage()!
  await p.locator('[data-extension="Test Marker"]').getByRole('button', { name: 'Remove' }).click()
  await waitFor(() => inMain<number>(h.app, 'return s.extensions.list().length'), (n) => n === 0)
  expect(readdirSync(root).filter((n) => /^[a-p]{32}$/.test(n))).toHaveLength(0)
  expect(JSON.parse(readFileSync(join(root, 'extensions.json'), 'utf8'))).toEqual([])
})

test('a .crx package installs; hostile or broken packages are refused and leave nothing behind', async () => {
  const work = tmp('bmax-crx-')
  const zipFiles = [{ name: 'manifest.json', data: JSON.stringify(MANIFEST({ name: 'From CRX' })) }, ...Object.entries(FILES).map(([name, data]) => ({ name, data }))]
  const crx = join(work, 'good.crx')
  writeFileSync(crx, buildCrx3(buildZip(zipFiles)))
  const ok = await inMain<{ ok: boolean; message?: string }>(h.app, `return await s.extensions.installCrxFile(arg, async () => true)`, crx)
  expect(ok.ok, ok.message).toBe(true)
  const ext = await openExtWindow(h.app)
  await load(h.app, ext, `${server.origin}/ext-page`)
  expect(await marker(h.app, ext)).toBe('on')
  await closeExtWindows(h.app)

  // A package whose entries try to escape the extraction folder.
  const slip = join(work, 'slip.crx')
  writeFileSync(slip, buildCrx3(buildZip([{ name: 'manifest.json', data: JSON.stringify(MANIFEST()) }, { name: '../../escaped.txt', data: 'pwn' }])))
  const bad = await inMain<{ ok: boolean; message?: string }>(h.app, `return await s.extensions.installCrxFile(arg, async () => true)`, slip)
  expect(bad.ok).toBe(false)
  expect(bad.message).toMatch(/Unsafe file name/)

  // Not an extension package at all, and an unsupported manifest version.
  const junk = join(work, 'junk.crx')
  writeFileSync(junk, Buffer.from('this is not a crx file, just some text. '.repeat(10)))
  expect((await inMain<{ ok: boolean }>(h.app, `return await s.extensions.installCrxFile(arg, async () => true)`, junk)).ok).toBe(false)
  const old = tmp('bmax-ext-src-')
  writeExtension(old, MANIFEST({ manifest_version: 1 }))
  const v1 = await inMain<{ ok: boolean; message?: string }>(h.app, `return await s.extensions.installFrom(arg, async () => true)`, old)
  expect(v1.ok).toBe(false)
  expect(v1.message).toMatch(/manifest_version/)
  const empty = tmp('bmax-ext-empty-')
  expect((await inMain<{ ok: boolean; message?: string }>(h.app, `return await s.extensions.installFrom(arg, async () => true)`, empty)).message).toMatch(/No manifest\.json/)

  expect(await inMain<string[]>(h.app, 'return s.extensions.list().map((e) => e.name)')).toEqual(['From CRX'])
  expect(existsSync(join(work, '..', 'escaped.txt'))).toBe(false)
  const id = (await inMain<{ id: string }[]>(h.app, 'return s.extensions.list()'))[0]!.id
  await inMain(h.app, `return s.extensions.remove(arg)`, id)
})

test('installed extensions survive a restart; the temporary profile folder is deleted at start-up', async () => {
  const userData = tmp('bmax-ext-ud-')
  const src = tmp('bmax-ext-src-')
  writeExtension(src)
  const first = await launch({ BMAX_SHIELDS_OFFLINE: '1', BMAX_USER_DATA: userData })
  try {
    const r = await inMain<{ ok: boolean; message?: string }>(first.app, `return await s.extensions.installFrom(arg, async () => true)`, src)
    expect(r.ok, r.message).toBe(true)
    const ext = await openExtWindow(first.app)
    await load(first.app, ext, `${server.origin}/ext-page`)
    expect(await marker(first.app, ext)).toBe('on')
    // The extension profile exists on disk while it is in use.
    expect(existsSync(join(userData, 'Partitions', 'bmax-ext'))).toBe(true)
  } finally {
    await first.app.close().catch(() => undefined)
  }
  // The package source can disappear: the installed copy is independent.
  rmSync(src, { recursive: true, force: true })
  const second = await launch({ BMAX_SHIELDS_OFFLINE: '1', BMAX_USER_DATA: userData })
  try {
    // Nothing of the previous extension profile is left, and it is not even created until an extension window is opened.
    expect(existsSync(join(userData, 'Partitions', 'bmax-ext'))).toBe(false)
    const list = await inMain<{ name: string; enabled: boolean; error?: string }[]>(second.app, 'return s.extensions.list()')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Test Marker', enabled: true })
    const ext = await openExtWindow(second.app)
    await load(second.app, ext, `${server.origin}/ext-page`)
    expect(await marker(second.app, ext)).toBe('on')
    expect((await inMain<{ error?: string }[]>(second.app, 'return s.extensions.list()'))[0]!.error).toBeUndefined()
  } finally {
    await second.app.close().catch(() => undefined)
  }
})
