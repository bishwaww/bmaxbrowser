import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { inMain, launch, screenshot, sleep } from './helpers'
import type { Harness } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'

let server: TestServer
let h: Harness
test.beforeAll(async () => {
  server = await startServer()
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1' })
})
test.afterAll(async () => {
  await h.close()
  await server.close()
})

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
const go = async (url: string): Promise<void> => {
  await inMain(h.app, `s.windows.focused().go(arg)`, url)
  await waitFor(() => inMain<string>(h.app, `const t = s.windows.focused().activeTab; return t.loading ? '' : t.wc.getURL()`), (u) => u === url)
}
const favicon = (): Promise<string | null> => inMain(h.app, `return s.windows.focused().activeTab.favicon`)

test('a tab keeps its site icon while moving between pages of the same site, and drops it on another site', async () => {
  await go(`${server.origin}/`)
  expect(await waitFor(favicon, (f) => !!f)).toMatch(/^data:image\/png/)
  await expect(chromePage(h.app).locator('[role="tab"] img, [data-tab] img').first()).toBeVisible()

  // Same site, same icon file: Chromium does not announce it again, so the tab must not have thrown it away.
  await go(`${server.origin}/icon-page-2`)
  await sleep(2500)
  expect(await favicon()).toMatch(/^data:image\/png/)

  // Another site without an icon: the old icon must not stick.
  await go(`${server.alt}/b`)
  await sleep(2500)
  expect(await favicon()).toBeNull()
})

test('an icon served without an image content type is still shown', async () => {
  await go(`${server.origin}/icon-octet-page`)
  expect(await waitFor(favicon, (f) => !!f)).toMatch(/^data:image\/png/)
})

test('bookmarks without an icon get the site icon once the site has been open; shortcuts and the bookmarks page show it', async () => {
  await inMain(h.app, `s.bookmarks.import([{ title: 'Imported page', url: arg + '/b', folder: '' }])`, server.origin)
  expect(await inMain<boolean>(h.app, `return !!s.bookmarks.list()[0].icon`)).toBe(false)
  await go(`${server.origin}/`)
  await waitFor(favicon, (f) => !!f)
  expect(await waitFor(() => inMain<boolean>(h.app, `return !!s.bookmarks.list()[0].icon`), (v) => v)).toBe(true)
  const item = chromePage(h.app).locator(`[data-bookmark="${server.origin}/b"]`)
  await expect(item.locator('img')).toBeVisible()
  await screenshot(h.app, 'chrome', 'icons-bar.png')

  // Any address of that site resolves to the icon (used by new-tab shortcuts).
  const icons = await inMain<Record<string, string | null>>(
    h.app,
    `const w = s.windows.focused(); return await w.chromeView.webContents.executeJavaScript('window.bmax.cmd("icons.get", { urls: ' + JSON.stringify(arg) + ' })')`,
    [`${server.origin}/some/other/page`, 'https://never-opened.example/']
  )
  expect(icons[`${server.origin}/some/other/page`]).toMatch(/^data:image\/png/)
  expect(icons['https://never-opened.example/']).toBeNull()

  // New-tab shortcut for that site shows the icon instead of a letter.
  await inMain(h.app, `s.settings.update({ tiles: [{ id: 't1', title: 'Local site', url: arg + '/' }] })`, server.origin)
  await inMain(h.app, `s.windows.focused().openTab('bmax://newtab')`)
  const newtab = await waitFor(async () => h.app.windows().filter((p) => p.url().startsWith('bmax://newtab')).pop(), (p) => !!p)
  await expect(newtab!.locator('[data-tile-icon] img')).toBeVisible()
  await screenshot(h.app, 'tab', 'icons-newtab.png')

  await inMain(h.app, `s.windows.focused().execute('bookmarks')`)
  const page = await waitFor(async () => h.app.windows().find((p) => p.url().startsWith('bmax://bookmarks')), (p) => !!p)
  await expect(page!.locator('li', { hasText: 'Imported page' }).locator('img')).toBeVisible()
})

test('the bookmark star sits inside the address bar', async () => {
  await go(`${server.origin}/b`)
  const cp = chromePage(h.app)
  const star = cp.getByLabel('Bookmark this page')
  await expect(star).toBeVisible()
  const field = await cp.getByLabel('Address bar').evaluate((el) => {
    const r = el.parentElement!.parentElement!.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  })
  const box = (await star.boundingBox())!
  expect(box.x).toBeGreaterThan(field.left)
  expect(box.x + box.width).toBeLessThanOrEqual(field.right)
  expect(box.y).toBeGreaterThanOrEqual(field.top)
  expect(box.y + box.height).toBeLessThanOrEqual(field.bottom)
  // The page is already bookmarked (previous test): the star is filled, and one click removes it.
  await expect(star).toHaveAttribute('aria-pressed', 'true')
  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  // Not offered on internal pages.
  await inMain(h.app, `s.windows.focused().execute('settings')`)
  await expect(star).toHaveCount(0)
})

test('an Update button appears in the toolbar when a new version exists: click downloads, click again restarts into it', async () => {
  const cp = chromePage(h.app)
  const button = cp.getByLabel('Update BMAX')
  await expect(button).toHaveCount(0)
  await inMain(
    h.app,
    `const EE = process.getBuiltinModule('node:events').EventEmitter
     const f = new EE()
     f.checkForUpdates = async () => { setTimeout(() => f.emit('update-available', { version: '9.9.9' }), 5) }
     f.downloadUpdate = async () => { f.emit('download-progress', { percent: 50 }); setTimeout(() => f.emit('update-downloaded', { version: '9.9.9' }), 400) }
     f.quitAndInstall = () => { globalThis.__installed = true }
     s.updates.loader = async () => f
     s.updates.forceSupported = true
     await s.updates.check()`
  )
  await expect(button).toHaveAttribute('data-update', 'available')
  await expect(button).toHaveText('Update')
  await screenshot(h.app, 'chrome', 'update-button.png')
  await button.click()
  await expect(button).toHaveAttribute('data-update', 'downloaded')
  await expect(button).toHaveText('Restart to update')
  await button.click()
  expect(await waitFor(() => inMain<boolean>(h.app, `return globalThis.__installed === true`), (v) => v)).toBe(true)

  // The menu has "Check for updates", which opens Settings -> About.
  await inMain(h.app, `s.updates.forceSupported = false`)
  await cp.getByLabel('Menu').click()
  const menu = await waitFor(async () => h.app.windows().find((p) => p.url().includes('kind=menu')), (p) => !!p)
  await menu!.getByText('Check for updates').click()
  const about = await waitFor(async () => h.app.windows().find((p) => p.url().startsWith('bmax://settings') && p.url().includes('section=About')), (p) => !!p)
  await expect(about!.getByTestId('update-status')).toBeVisible()
})
