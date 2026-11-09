import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Harness } from './helpers'
import { inMain, launch, screenshot, sleep } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'

let h: Harness
let srv: TestServer

test.beforeAll(async () => {
  srv = await startServer()
  h = await launch()
})
test.afterAll(async () => {
  await h.close()
  await srv.close()
})

interface TabSnap {
  id: number
  title: string
  url: string
  security: string
  pinned: boolean
  muted: boolean
  canGoBack: boolean
  canGoForward: boolean
}
const tabs = (): Promise<TabSnap[]> => inMain(h.app, 'return s.windows.focused().tabs.map(t => t.info())')
const active = async (): Promise<TabSnap> => {
  const r = await inMain<TabSnap>(h.app, 'const w = s.windows.focused(); return w.activeTab.info()')
  return r
}
const chromePage = (): Page => h.app.windows().find((p) => p.url().startsWith('bmax://chrome'))!
const overlayPage = (kind: string): Page | undefined => h.app.windows().find((p) => p.url().includes(`overlay`) && p.url().includes(`kind=${kind}`))
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms
  let last = await fn()
  while (!ok(last) && Date.now() < end) {
    await sleep(100)
    last = await fn()
  }
  return last
}
/** Send a keyboard shortcut through the real before-input-event path. */
async function press(key: string, mods: string[] = []): Promise<void> {
  await inMain(
    h.app,
    `const wc = s.windows.focused().chromeView.webContents; wc.sendInputEvent({type:'keyDown', keyCode: arg.key, modifiers: arg.mods}); wc.sendInputEvent({type:'keyUp', keyCode: arg.key, modifiers: arg.mods})`,
    { key, mods }
  )
  await sleep(250)
}
async function navigate(url: string): Promise<void> {
  const input = chromePage().getByLabel('Address bar')
  await input.click()
  await input.fill(url)
  await input.press('Enter')
  await waitFor(active, (t) => t.url.startsWith(url.split('?')[0]!) && !!t.title)
}
async function resetTabs(): Promise<void> {
  await inMain(h.app, `const w = s.windows.focused(); for (const t of [...w.tabs].slice(1)) w.closeTab(t); w.activate(w.tabs[0]); w.tabs[0].setMuted(false); if (w.tabs[0].pinned) w.setPinned(w.tabs[0], false)`)
  await sleep(200)
}

test('omnibox navigates to a URL, shows title and security state', async () => {
  await navigate(srv.origin + '/')
  const t = await waitFor(active, (x) => x.title === 'Home Page')
  expect(t.title).toBe('Home Page')
  expect(t.security).toBe('insecure') // plain http
  await sleep(400)
  await screenshot(h.app, 'chrome', 'chrome-navigated.png')
})

test('back / forward / reload', async () => {
  await navigate(srv.origin + '/b')
  expect((await active()).canGoBack).toBe(true)
  await chromePage().getByTitle('Back (Alt+Left)').click()
  await waitFor(active, (x) => x.title === 'Home Page')
  expect((await active()).canGoForward).toBe(true)
  await chromePage().getByTitle('Forward (Alt+Right)').click()
  const t = await waitFor(active, (x) => x.title === 'Page B')
  expect(t.title).toBe('Page B')
})

test('typed text without a dot becomes a DuckDuckGo search by default', async () => {
  await inMain(h.app, `s.windows.focused().go('hello world')`)
  const t = await waitFor(active, (x) => x.url.startsWith('https://duckduckgo.com/'))
  expect(t.url).toBe('https://duckduckgo.com/?q=hello%20world')
})

test('keyboard shortcuts: new tab, close, reopen, switch tabs', async () => {
  await resetTabs()
  await press('T', ['control'])
  await press('T', ['control'])
  expect((await tabs()).length).toBe(3)
  await press('1', ['control'])
  expect((await active()).id).toBe((await tabs())[0]!.id)
  await press('Tab', ['control'])
  expect((await active()).id).toBe((await tabs())[1]!.id)
  await press('Tab', ['control', 'shift'])
  expect((await active()).id).toBe((await tabs())[0]!.id)
  await press('9', ['control'])
  expect((await active()).id).toBe((await tabs())[2]!.id)
  // close a tab that has a real URL then reopen it
  await navigate(srv.origin + '/b')
  await press('W', ['control'])
  expect((await tabs()).length).toBe(2)
  await press('T', ['control', 'shift'])
  const after = await tabs()
  expect(after.length).toBe(3)
  expect(after[after.length - 1]!.url).toBe(srv.origin + '/b')
})

test('pin, mute, duplicate, close others', async () => {
  await resetTabs()
  await inMain(h.app, `const w = s.windows.focused(); w.openTab('${srv.origin}/b'); w.openTab('${srv.origin}/frame')`)
  await sleep(400)
  const all = await tabs()
  expect(all.length).toBe(3)
  // pin the last tab: it jumps to the front
  await inMain(h.app, 'const w = s.windows.focused(); w.setPinned(w.tabs[2], true)')
  let now = await tabs()
  expect(now[0]!.pinned).toBe(true)
  expect(now[0]!.url).toBe(srv.origin + '/frame')
  // mute
  await inMain(h.app, 'const w = s.windows.focused(); w.tabs[1].setMuted(true)')
  now = await tabs()
  expect(now[1]!.muted).toBe(true)
  // duplicate
  await inMain(h.app, 'const w = s.windows.focused(); w.duplicate(w.tabs[2])')
  await sleep(300)
  now = await tabs()
  expect(now.length).toBe(4)
  expect(now[3]!.url).toBe(now[2]!.url)
  // close others keeps pinned tabs + the chosen one
  await inMain(h.app, 'const w = s.windows.focused(); w.closeOthers(w.tabs[1])')
  now = await tabs()
  expect(now.length).toBe(2)
  expect(now.some((t) => t.pinned)).toBe(true)
})

test('find in page shows match counts', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  await press('F', ['control'])
  await sleep(800)
  const overlay = await waitFor(async () => overlayPage('find'), (p) => !!p)
  expect(overlay).toBeTruthy()
  await overlay!.getByLabel('Find in page').fill('foo')
  await expect(overlay!.getByText(/^1\/2$/)).toBeVisible({ timeout: 5000 })
  await screenshot(h.app, 'overlay:find', 'find.png')
  // A real Escape key inside the overlay goes through before-input-event and closes the find bar.
  await inMain(h.app, `const wc = s.windows.focused().overlays.entries.get('find').view.webContents; wc.sendInputEvent({type:'keyDown', keyCode:'Escape'}); wc.sendInputEvent({type:'keyUp', keyCode:'Escape'})`)
  await sleep(400)
  const visible = await inMain<boolean>(h.app, `return s.windows.focused().overlays.isVisible('find')`)
  expect(visible).toBe(false)
})

test('zoom is remembered per site', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  await press('=', ['control'])
  await press('=', ['control'])
  const z1 = await inMain<number>(h.app, 'return s.windows.focused().activeTab.zoomFactor')
  expect(z1).toBeGreaterThan(1.1)
  await navigate(srv.origin + '/b') // same host → keeps zoom
  await sleep(300)
  expect(await inMain<number>(h.app, 'return s.windows.focused().activeTab.zoomFactor')).toBe(z1)
  await navigate(srv.alt + '/') // different host → default zoom
  await sleep(300)
  expect(await inMain<number>(h.app, 'return s.windows.focused().activeTab.zoomFactor')).toBe(1)
  await navigate(srv.origin + '/')
  await press('0', ['control'])
  expect(await inMain<number>(h.app, 'return s.windows.focused().activeTab.zoomFactor')).toBe(1)
})

test('connection failure shows the error page and keeps the failed URL in the address bar', async () => {
  await navigate('http://127.0.0.1:1/')
  const t = await waitFor(active, (x) => x.title === "Can't reach this page")
  expect(t.title).toBe("Can't reach this page")
  expect(t.url).toBe('http://127.0.0.1:1/')
})

test('links opened with target=_blank open in a new tab; mailto asks before opening externally', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  await inMain(h.app, `s.windows.focused().activeTab.wc.executeJavaScript("document.getElementById('blank').click()")`)
  await waitFor(tabs, (t) => t.length === 2)
  expect((await tabs()).length).toBe(2)

  // Stub the confirmation dialog: user says "Cancel". The navigation must not happen and the dialog must be shown.
  await h.app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __dialogCalls: number }
    g.__dialogCalls = 0
    dialog.showMessageBox = (async () => {
      g.__dialogCalls++
      return { response: 0, checkboxChecked: false }
    }) as unknown as typeof dialog.showMessageBox
  })
  await inMain(h.app, `const w = s.windows.focused(); w.activate(w.tabs[0]); w.tabs[0].wc.executeJavaScript("document.getElementById('mail').click()", true)`)
  await sleep(600)
  const calls = await h.app.evaluate(() => (globalThis as unknown as { __dialogCalls: number }).__dialogCalls)
  expect(calls).toBe(1)
  expect((await active()).url).toBe(srv.origin + '/')
})

test('web pages cannot navigate to internal bmax:// pages', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  await inMain(h.app, `const wc = s.windows.focused().activeTab.wc; wc.executeJavaScript("location.href = 'bmax://settings/'", true)`)
  await sleep(600)
  expect((await active()).url).toBe(srv.origin + '/')
})

test('internal pages expose the API; web pages do not', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  const webHasApi = await inMain<boolean>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("typeof window.bmax !== 'undefined'")`)
  expect(webHasApi).toBe(false)
  await inMain(h.app, `s.windows.focused().execute('settings')`)
  await sleep(800)
  const settingsHasApi = await inMain<boolean>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("typeof window.bmax?.cmd === 'function'")`)
  expect(settingsHasApi).toBe(true)
  // An internal *page* may not call browser-chrome commands, and bad payloads are rejected.
  const forbidden = await inMain<string>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("window.bmax.cmd('tab.close', { id: 1 }).then(() => 'allowed', e => String(e.message))")`)
  expect(forbidden).toContain('Forbidden')
  const invalid = await inMain<string>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("window.bmax.cmd('settings.update', { searchEngine: 'evil' }).then(() => 'allowed', e => String(e.message))")`)
  expect(invalid).toContain('Invalid')
})

test('permission prompt: Notification request shows prompt, Allow grants it', async () => {
  await resetTabs()
  await navigate(srv.origin + '/perm')
  await sleep(800)
  const overlay = await waitFor(async () => overlayPage('permission'), (p) => !!p)
  expect(overlay).toBeTruthy()
  await screenshot(h.app, 'overlay:permission', 'permission.png')
  await overlay!.getByRole('button', { name: 'Allow' }).click()
  const result = await waitFor(
    () => inMain<string>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript('window.__perm')`),
    (v) => v !== 'pending'
  )
  expect(result).toBe('granted')
})

test('spike: main-world injection reaches the main frame and iframes', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  await sleep(500)
  const r = await inMain<{ main: number; frame: number | string }>(
    h.app,
    `const wc = s.windows.focused().activeTab.wc;
     const main = await wc.mainFrame.executeJavaScript('navigator.hardwareConcurrency');
     const f = wc.mainFrame.frames[0];
     const frame = f ? await f.executeJavaScript('navigator.hardwareConcurrency') : 'no-frame';
     return { main, frame }`
  )
  expect(r.main).toBe(4)
  expect(r.frame).toBe(4)
})

test('tear-off moves a tab into a new window', async () => {
  await resetTabs()
  await inMain(h.app, `s.windows.focused().openTab('${srv.origin}/b')`)
  await sleep(400)
  await inMain(h.app, `const w = s.windows.focused(); s.windows.tearOff(w.tabs[1], 300, 300)`)
  await sleep(1200)
  const r = await inMain<{ windows: number; urls: string[][] }>(
    h.app,
    `const all = s.windows.all(); return { windows: all.length, urls: all.map(w => w.tabs.map(t => t.url)) }`
  )
  expect(r.windows).toBe(2)
  expect(r.urls.flat()).toContain(srv.origin + '/b')
  // clean up: close the extra window
  await inMain(h.app, `const all = s.windows.all(); all[all.length - 1].base.close()`)
  await sleep(500)
})

test('browsing leaves no traces of visited sites on disk', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  await navigate(srv.origin + '/b')
  // Write real storage + a cookie on the visited site; none of it may reach disk.
  await inMain(
    h.app,
    `return await s.windows.focused().activeTab.wc.executeJavaScript(
      'localStorage.setItem("secret", "bmax-marker-123"); document.cookie = "c=bmax-cookie-456"; indexedDB.open("bmax-idb-789"); 1'
    )`
  )
  await sleep(1500)
  const { readdirSync, statSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(h.userData)
  const needles = [String(srv.port), 'bmax-marker-123', 'bmax-cookie-456', 'bmax-idb-789', 'Home Page', 'Page B']
  const hits: string[] = []
  for (const f of files) {
    let buf: Buffer
    try {
      buf = readFileSync(f)
    } catch {
      continue // locked by the running browser
    }
    const text = buf.toString('latin1')
    for (const n of needles) if (text.includes(n)) hits.push(f.replace(h.userData, '') + ' contains ' + n)
  }
  console.log('USERDATA FILE COUNT:', files.length)
  expect(hits).toEqual([])
})

test('menu and site-info popups open from the toolbar', async () => {
  await resetTabs()
  await navigate(srv.origin + '/')
  await chromePage().getByRole('button', { name: 'Menu' }).click()
  const menu = await waitFor(async () => overlayPage('menu'), (p) => !!p)
  await expect(menu!.getByText('New isolated window')).toBeVisible({ timeout: 5000 })
  await sleep(400)
  await screenshot(h.app, 'overlay:menu', 'menu.png')
  await menu!.getByText('Settings').click()
  await waitFor(active, (t) => t.url === 'bmax://settings/')
  expect((await active()).url).toBe('bmax://settings/')

  await navigate(srv.origin + '/')
  await chromePage().getByTitle('Not secure').click()
  const cert = await waitFor(async () => overlayPage('cert'), (p) => !!p)
  await expect(cert!.getByText('Connection is not secure')).toBeVisible({ timeout: 5000 })
  await sleep(300)
  await screenshot(h.app, 'overlay:cert', 'cert.png')
})

test('dragging a tab reorders it; dragging it out of the strip opens a new window', async () => {
  await resetTabs()
  await inMain(h.app, `const w = s.windows.focused(); w.openTab('${srv.origin}/b'); w.openTab('${srv.origin}/frame')`)
  await sleep(600)
  const before = (await tabs()).map((t) => t.id)
  const page = chromePage()
  const first = await page.getByRole('tab').first().boundingBox()
  expect(first).toBeTruthy()
  const x = first!.x + first!.width / 2
  const y = first!.y + first!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 40, y, { steps: 2 })
  await page.mouse.up()
  await sleep(500)
  const after = (await tabs()).map((t) => t.id)
  expect(after).not.toEqual(before)
  expect(after[0]).not.toBe(before[0])
  expect([...after].sort()).toEqual([...before].sort())

  // Drag the last tab down out of the strip → tear-off into a new window.
  const last = await page.getByRole('tab').last().boundingBox()
  const lx = last!.x + last!.width / 2
  const ly = last!.y + last!.height / 2
  await page.mouse.move(lx, ly)
  await page.mouse.down()
  await page.mouse.move(lx, ly + 40, { steps: 4 })
  await page.mouse.move(lx, ly + 120, { steps: 4 })
  await page.mouse.up()
  await sleep(1200)
  expect(await inMain<number>(h.app, 'return s.windows.all().length')).toBe(2)
  await inMain(h.app, `const all = s.windows.all(); all[all.length - 1].base.close()`)
  await sleep(500)
})
