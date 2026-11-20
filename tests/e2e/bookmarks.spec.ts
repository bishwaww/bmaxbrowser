import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inMain, launch, screenshot, sleep } from './helpers'
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
const profile = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'bmax-bm-'))
  dirs.push(d)
  return d
}
const env = (userData: string): Record<string, string> => ({ BMAX_SHIELDS_OFFLINE: '1', BMAX_USER_DATA: userData })
const chromePage = (app: ElectronApplication): Page => app.windows().find((p) => p.url().startsWith('bmax://chrome'))!
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) {
    await sleep(150)
    v = await fn()
  }
  return v
}
const press = async (app: ElectronApplication, key: string, mods: string[]): Promise<void> => {
  await inMain(app, `const wc = s.windows.focused().chromeView.webContents; wc.sendInputEvent({type:'keyDown', keyCode: arg.key, modifiers: arg.mods}); wc.sendInputEvent({type:'keyUp', keyCode: arg.key, modifiers: arg.mods})`, { key, mods })
  await sleep(300)
}
const go = async (app: ElectronApplication, url: string): Promise<void> => {
  await inMain(app, `s.windows.focused().go(arg)`, url)
  await waitFor(() => inMain<string>(app, `const t = s.windows.focused().activeTab; return t.loading ? '' : t.wc.getURL()`), (u) => u === url)
  await sleep(200)
}

test('bookmarks need no password: star a page, see it in the bookmarks bar, open it with one click', async () => {
  const userData = profile()
  const h = await launch(env(userData))
  try {
    const bar = chromePage(h.app).getByRole('toolbar', { name: 'Bookmarks bar' })
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('Bookmarks you add')
    // No vault exists and none is needed.
    expect(await inMain<boolean>(h.app, 'return s.vault.status().exists')).toBe(false)

    await go(h.app, `${server.origin}/b`)
    const bookmarked = (): Promise<boolean> => inMain(h.app, 'return s.windows.focused().activeTab.info().bookmarked')
    expect(await bookmarked()).toBe(false)
    await press(h.app, 'D', ['control'])
    expect(await bookmarked()).toBe(true)
    // Stayed on the page (no detour through a vault page).
    expect(await inMain<string>(h.app, 'return s.windows.focused().activeTab.url')).toBe(`${server.origin}/b`)
    const item = bar.locator(`[data-bookmark="${server.origin}/b"]`)
    await expect(item).toBeVisible()
    await expect(item).toContainText('Page B')
    await screenshot(h.app, 'chrome', 'bookmarks-bar.png')

    // The star button removes and re-adds it.
    await chromePage(h.app).getByLabel('Bookmark this page').click()
    await expect(item).toHaveCount(0)
    await chromePage(h.app).getByLabel('Bookmark this page').click()
    await expect(item).toBeVisible()

    // One click on the bar opens the bookmark in the current tab.
    await go(h.app, `${server.origin}/`)
    await item.click()
    await waitFor(() => inMain<string>(h.app, 'return s.windows.focused().activeTab.wc.getURL()'), (u) => u === `${server.origin}/b`)
    expect(await inMain<string>(h.app, 'return s.windows.focused().activeTab.wc.getURL()')).toBe(`${server.origin}/b`)
    expect(await inMain<number>(h.app, 'return s.windows.focused().tabs.length')).toBe(1)

    // Stored as a plain file in the app data folder.
    const saved = JSON.parse(readFileSync(join(userData, 'bookmarks.json'), 'utf8')) as { url: string; title: string }[]
    expect(saved.map((b) => b.url)).toEqual([`${server.origin}/b`])
  } finally {
    await h.app.close().catch(() => undefined)
  }

  // Bookmarks survive a restart and are there immediately.
  const again = await launch(env(userData))
  try {
    await expect(chromePage(again.app).locator(`[data-bookmark="${server.origin}/b"]`)).toBeVisible()
  } finally {
    await again.app.close().catch(() => undefined)
  }
})

test('bookmarks page lists, searches, imports and deletes; the bar can be hidden (Ctrl+Shift+B) and the page area follows', async () => {
  const h = await launch(env(profile()))
  try {
    await inMain(
      h.app,
      `s.bookmarks.import([{ title: 'Alpha site', url: 'https://alpha.example/', folder: 'Imported' }, { title: 'Beta site', url: 'https://beta.example/', folder: 'Imported' }, { title: 'Alpha site', url: 'https://alpha.example/', folder: 'dup' }])`
    )
    expect(await inMain<number>(h.app, 'return s.bookmarks.list().length')).toBe(2)
    await inMain(h.app, `s.windows.focused().execute('bookmarks')`)
    const page = await waitFor(async () => h.app.windows().find((p) => p.url().startsWith('bmax://bookmarks')), (p) => !!p)
    await expect(page!.getByText('Alpha site')).toBeVisible()
    await expect(page!.getByText('Beta site')).toBeVisible()
    await page!.getByPlaceholder('Search bookmarks').fill('beta')
    await expect(page!.getByText('Alpha site')).toHaveCount(0)
    await page!.getByPlaceholder('Search bookmarks').fill('')
    await screenshot(h.app, 'tab', 'bookmarks-page.png')
    // Deleting on the page updates the bar at once.
    const bar = chromePage(h.app).getByRole('toolbar', { name: 'Bookmarks bar' })
    await expect(bar.locator('[data-bookmark="https://alpha.example/"]')).toBeVisible()
    await page!.locator('li', { hasText: 'Alpha site' }).hover()
    await page!.locator('li', { hasText: 'Alpha site' }).getByTitle('Delete').click()
    await expect(bar.locator('[data-bookmark="https://alpha.example/"]')).toHaveCount(0)

    // Hide / show the bar: the page view moves up and down by the bar's height.
    const top = (): Promise<number> => inMain(h.app, 'return s.windows.focused().activeTab.view.getBounds().y')
    expect(await top()).toBe(84 + 32)
    await press(h.app, 'B', ['control', 'shift'])
    await waitFor(top, (y) => y === 84)
    expect(await top()).toBe(84)
    await expect(bar).toHaveCount(0)
    expect(await inMain<boolean>(h.app, 'return s.settings.get().showBookmarksBar')).toBe(false)
    await press(h.app, 'B', ['control', 'shift'])
    await waitFor(top, (y) => y === 116)
    await expect(bar).toBeVisible()
  } finally {
    await h.app.close().catch(() => undefined)
  }
})

test('hidden menus and panels are released after a while and come back on demand', async () => {
  const h = await launch(env(profile()))
  try {
    await chromePage(h.app).getByLabel('Menu').click()
    const menu = await waitFor(async () => h.app.windows().find((p) => p.url().includes('kind=menu')), (p) => !!p)
    await expect(menu!.getByText('New tab')).toBeVisible()
    await expect(menu!.getByText('Bookmarks', { exact: true })).toBeVisible()
    await expect(menu!.getByText('Download video from this page')).toBeVisible()
    await inMain(h.app, `s.windows.focused().overlays.hide('menu')`)
    expect(await inMain<boolean>(h.app, `return s.windows.focused().overlays.entries.has('menu')`)).toBe(true)
    // (The idle timer is 45 s; trigger the release directly.)
    await inMain(h.app, `s.windows.focused().overlays.release('menu')`)
    expect(await inMain<boolean>(h.app, `return s.windows.focused().overlays.entries.has('menu')`)).toBe(false)
    await waitFor(async () => h.app.windows().some((p) => p.url().includes('kind=menu')), (v) => v === false)
    // A visible overlay is never released. (Wait out the menu button's toggle guard first.)
    await sleep(500)
    await chromePage(h.app).getByLabel('Menu').click()
    const menu2 = await waitFor(async () => h.app.windows().find((p) => p.url().includes('kind=menu')), (p) => !!p)
    await expect(menu2!.getByText('New tab')).toBeVisible()
    await inMain(h.app, `s.windows.focused().overlays.release('menu')`)
    expect(await inMain<boolean>(h.app, `return s.windows.focused().overlays.entries.has('menu')`)).toBe(true)
  } finally {
    await h.app.close().catch(() => undefined)
  }
})

test('"Keep me signed in" is off by default; when on, cookies and site data survive a restart; turning it off deletes them', async () => {
  const userData = profile()
  const read = `return await s.windows.focused().activeTab.wc.executeJavaScript("JSON.stringify({ ls: localStorage.getItem('k'), ck: document.cookie })")`
  const write = `return await s.windows.focused().activeTab.wc.executeJavaScript("localStorage.setItem('k', 'kept'); document.cookie = 'sid=1; path=/; max-age=86400'; 1")`

  // Default (off): nothing survives.
  let h = await launch(env(userData))
  expect(await inMain<boolean>(h.app, 'return s.settings.get().privacy.keepSiteData')).toBe(false)
  await go(h.app, `${server.origin}/b`)
  await inMain(h.app, write)
  await h.app.close().catch(() => undefined)
  h = await launch(env(userData))
  await go(h.app, `${server.origin}/b`)
  expect(JSON.parse(await inMain<string>(h.app, read))).toEqual({ ls: null, ck: '' })
  expect(existsSync(join(userData, 'Partitions', 'bmax-main'))).toBe(false)
  // Opt in (applies from the next start).
  await inMain(h.app, `s.settings.update({ privacy: { ...s.settings.get().privacy, keepSiteData: true } })`)
  await sleep(600)
  await h.app.close().catch(() => undefined)

  h = await launch(env(userData))
  await go(h.app, `${server.origin}/b`)
  await inMain(h.app, write)
  await sleep(1500)
  await h.app.close().catch(() => undefined)
  h = await launch(env(userData))
  await go(h.app, `${server.origin}/b`)
  expect(JSON.parse(await inMain<string>(h.app, read))).toEqual({ ls: 'kept', ck: 'sid=1' })
  // Container tabs still keep nothing, and Burn still wipes the kept data.
  await inMain(h.app, 'await s.windows.burn()')
  await sleep(800)
  await go(h.app, `${server.origin}/b`)
  expect(JSON.parse(await inMain<string>(h.app, read))).toEqual({ ls: null, ck: '' })
  await inMain(h.app, write)
  // Turn it off: the data is wiped now and the folder is deleted at the next start.
  await inMain(h.app, `s.settings.update({ privacy: { ...s.settings.get().privacy, keepSiteData: false } })`)
  await sleep(1200)
  await h.app.close().catch(() => undefined)
  h = await launch(env(userData))
  try {
    expect(existsSync(join(userData, 'Partitions', 'bmax-main'))).toBe(false)
    await go(h.app, `${server.origin}/b`)
    expect(JSON.parse(await inMain<string>(h.app, read))).toEqual({ ls: null, ck: '' })
  } finally {
    await h.app.close().catch(() => undefined)
  }
})
