import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Harness } from './helpers'
import { inMain, launch, screenshot, sleep } from './helpers'
import { startMediaServer } from './media-server'
import type { MediaServer } from './media-server'
import { startServer } from './server'
import type { TestServer } from './server'

let h: Harness
let server: TestServer
let media: MediaServer

test.beforeAll(async () => {
  server = await startServer()
  media = await startMediaServer()
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1' })
})
test.afterAll(async () => {
  await h.close()
  await server.close()
  await media.close()
})

const chromePage = (): Page => h.app.windows().find((p) => p.url().startsWith('bmax://chrome'))!
const pageOf = (name: string): Page | undefined => h.app.windows().find((p) => p.url().startsWith(`bmax://${name}`))

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) {
    await sleep(150)
    v = await fn()
  }
  return v
}
async function go(url: string): Promise<void> {
  await inMain(h.app, `s.windows.focused().go(arg)`, url)
  await sleep(200)
  await waitFor(
    () => inMain<boolean>(h.app, `const t = s.windows.focused().activeTab; return !t.loading && t.wc.getURL() !== ''`),
    (v) => v
  )
  await sleep(300)
}
const tabUrl = (): Promise<string> => inMain(h.app, `return s.windows.focused().activeTab.url`)

// ---------------------------------------------------------------- performance budget

test('first window appears in under 2 seconds', async () => {
  const m = await inMain<{ firstWindowMs: number | null; readyMs: number | null }>(h.app, 'return s.metrics')
  console.log(`[perf] app ready at ${m.readyMs} ms, first window shown at ${m.firstWindowMs} ms (process start → window visible)`)
  expect(m.firstWindowMs).not.toBeNull()
  expect(m.firstWindowMs!).toBeLessThan(2000)
})

// ---------------------------------------------------------------- settings

test('settings has every section, including the new ones', async () => {
  await go('bmax://settings/')
  const p = (await waitFor(async () => pageOf('settings'), (x) => !!x))!
  for (const name of ['General', 'Appearance', 'Search', 'Shields', 'Privacy & Security', 'Downloads', 'Torrents', 'Network', 'Tor', 'Extensions', 'Shortcuts', 'About']) {
    await expect(p.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name, exact: true })).toBeVisible()
  }
  // General: opt-in session restore is OFF by default, tab sleeping is on.
  await expect(p.getByRole('switch', { name: /Continue where I left off/ })).not.toBeChecked()
  await expect(p.getByLabel('Put background tabs to sleep')).toHaveValue('30')
  await screenshot(h.app, 'tab', 'settings-general.png')

  await p.getByRole('button', { name: 'Shortcuts' }).click()
  await expect(p.getByText('Reopen closed tab')).toBeVisible()
  await expect(p.locator('kbd').getByText('Ctrl+Shift+T', { exact: true })).toBeVisible()
  await screenshot(h.app, 'tab', 'settings-shortcuts.png')

  await p.getByRole('button', { name: 'Extensions' }).click()
  await expect(p.getByText('No extensions installed.')).toBeVisible()
  await expect(p.getByRole('button', { name: 'Load unpacked folder…' })).toBeVisible()
  await screenshot(h.app, 'tab', 'settings-extensions.png')

  await p.getByRole('button', { name: 'Appearance' }).click()
  await expect(p.getByText('Match the browser theme')).toBeVisible()
})

test('settings changes reach main and persist to the settings file', async () => {
  await go('bmax://settings/')
  const p = (await waitFor(async () => pageOf('settings'), (x) => !!x))!
  await p.getByRole('button', { name: 'General' }).click()
  await p.getByLabel('Put background tabs to sleep').selectOption('15')
  await waitFor(() => inMain<number>(h.app, 'return s.settings.get().general.sleepTabsAfterMin'), (v) => v === 15)
  await p.getByLabel('Put background tabs to sleep').selectOption('30')
  await waitFor(() => inMain<number>(h.app, 'return s.settings.get().general.sleepTabsAfterMin'), (v) => v === 30)
})

test('About shows the version and says updates are unavailable in a development build', async () => {
  await go('bmax://settings/?section=About')
  const p = (await waitFor(async () => pageOf('settings'), (x) => !!x))!
  await p.getByRole('button', { name: 'About' }).click()
  await expect(p.getByTestId('version')).toContainText('development build')
  await p.getByRole('button', { name: 'Check for updates' }).click()
  await expect(p.getByTestId('update-status')).toContainText('only available in installed builds')
  await screenshot(h.app, 'tab', 'settings-about.png')
})

test('update flow: check → available → download → ready to install (fake updater, nothing is downloaded)', async () => {
  const states = await inMain<string[]>(
    h.app,
    `
    const EE = process.getBuiltinModule('node:events').EventEmitter
    const f = new EE()
    let installed = false
    f.checkForUpdates = async () => { setTimeout(() => f.emit('update-available', { version: '9.9.9' }), 5) }
    f.downloadUpdate = async () => { f.emit('download-progress', { percent: 50 }); f.emit('update-downloaded', { version: '9.9.9' }) }
    f.quitAndInstall = () => { installed = true; globalThis.__installed = true }
    s.updates.loader = async () => f
    s.updates.forceSupported = true
    const seen = []
    s.updates.on('state', (st) => seen.push(st.status))
    await s.updates.check()
    await new Promise((r) => setTimeout(r, 50))
    await s.updates.download()
    s.updates.install()
    s.updates.forceSupported = false
    seen.push('installed=' + globalThis.__installed)
    return seen
  `
  )
  expect(states).toEqual(['checking', 'available', 'downloading', 'downloading', 'downloaded', 'installed=true'])
})

// ---------------------------------------------------------------- privacy policy page

test('the privacy policy page renders docs/PRIVACY.md', async () => {
  await go('bmax://privacy/')
  const p = (await waitFor(async () => pageOf('privacy'), (x) => !!x))!
  await expect(p.getByRole('heading', { level: 1 })).toContainText('What BMAX stores and sends')
  await expect(p.getByRole('heading', { name: 'Stored on disk' })).toBeVisible()
  await expect(p.getByRole('table').first()).toBeVisible()
  await expect(p.getByRole('heading', { name: /Torrents/ })).toBeVisible()
  await expect(p.getByRole('heading', { name: /Extensions/ })).toBeVisible()
  await screenshot(h.app, 'tab', 'privacy-policy.png')
})

// ---------------------------------------------------------------- reader mode

test('reader mode shows the article without clutter, and the sanitizer removes active content', async () => {
  await go(`${server.origin}/article`)
  await inMain(h.app, `s.windows.focused().execute('readerMode')`)
  const p = (await waitFor(async () => pageOf('reader'), (x) => !!x))!
  await expect(p.getByTestId('reader-title')).toHaveText('Test Article Title')
  const body = p.getByTestId('reader-body')
  await expect(body).toContainText('Paragraph 1')
  await expect(body).toContainText('Paragraph 8')
  await expect(body).not.toContainText('Subscribe to our newsletter')
  // The address bar keeps the original address.
  expect(await tabUrl()).toBe(`${server.origin}/article`)

  const audit = await p.evaluate(() => {
    const b = document.querySelector('[data-testid=reader-body]')!
    return {
      active: b.querySelectorAll('script,iframe,style,object,embed,form,input').length,
      handlers: Array.from(b.querySelectorAll('*')).filter((e) => Array.from(e.attributes).some((a) => a.name.startsWith('on') || a.name === 'style' || a.name === 'class' || a.name === 'id')).length,
      jsLinks: b.querySelectorAll('a[href^="javascript"]').length,
      pwned: (window as unknown as { __pwned?: number }).__pwned ?? null,
      imgs: Array.from(b.querySelectorAll('img')).map((i) => ({ rp: i.getAttribute('referrerpolicy'), src: i.getAttribute('src') }))
    }
  })
  expect(audit.active).toBe(0)
  expect(audit.handlers).toBe(0)
  expect(audit.jsLinks).toBe(0)
  expect(audit.pwned).toBeNull()
  expect(audit.imgs.length).toBeGreaterThan(0)
  for (const i of audit.imgs) {
    expect(i.rp).toBe('no-referrer')
    expect(i.src).toMatch(/^https?:/)
  }
  await screenshot(h.app, 'tab', 'reader.png')

  // Reader controls: font size is a setting (saved with the other settings).
  const before = await inMain<number>(h.app, 'return s.settings.get().reader.size')
  await p.getByRole('button', { name: 'Larger text' }).click()
  await waitFor(() => inMain<number>(h.app, 'return s.settings.get().reader.size'), (v) => v === before + 1)
  await p.getByLabel('Reader colours').selectOption('sepia')
  await waitFor(() => inMain<string>(h.app, 'return s.settings.get().reader.theme'), (v) => v === 'sepia')
  await expect(p.locator('.reader')).toHaveAttribute('data-rt', 'sepia')
  await screenshot(h.app, 'tab', 'reader-sepia.png')
  await inMain(h.app, `s.settings.update({ reader: { font: 'serif', size: ${before}, theme: 'auto' } })`)

  // Links in the article open in this tab.
  await p.locator('.reader-body a', { hasText: 'the other page' }).click()
  await waitFor(tabUrl, (u) => u === `${server.origin}/b`)
  expect(await tabUrl()).toBe(`${server.origin}/b`)
})

test('reader mode: "Original page" returns to the page; pages without an article say so', async () => {
  await go(`${server.origin}/article`)
  await inMain(h.app, `s.windows.focused().execute('readerMode')`)
  const p = (await waitFor(async () => pageOf('reader'), (x) => !!x))!
  await expect(p.getByTestId('reader-title')).toBeVisible()
  await p.getByRole('button', { name: '← Original page' }).click()
  await waitFor(() => inMain<string>(h.app, 'return s.windows.focused().activeTab.wc.getURL()'), (u) => u === `${server.origin}/article`)

  await go(`${server.origin}/b`)
  await inMain(h.app, `s.windows.focused().execute('readerMode')`)
  const q = (await waitFor(async () => pageOf('reader'), (x) => !!x))!
  await expect(q.getByTestId('reader-unavailable')).toBeVisible()
})

test('the reader page rebuilds hostile article HTML from an allow-list', async () => {
  const hostile = [
    '<p>safe text</p>',
    '<script>window.__pwned = "script"</script>',
    '<img src="x" onerror="window.__pwned = \'onerror\'">',
    '<img src="javascript:window.__pwned=1">',
    '<img src="data:text/html;base64,PHNjcmlwdD4=">',
    '<a href="javascript:window.__pwned=2" onclick="window.__pwned=3">js link</a>',
    '<a href="  jAvAsCrIpT:window.__pwned=4">spaced</a>',
    '<a href="data:text/html,<script>1</script>">data link</a>',
    '<iframe src="https://evil.example/"></iframe>',
    '<form action="https://evil.example"><input name="pw"><button>go</button></form>',
    '<svg onload="window.__pwned=5"><script>1</script></svg>',
    '<style>body{display:none}</style>',
    '<math><mi xlink:href="javascript:1">x</mi></math>',
    '<p style="position:fixed;top:0" class="evil" id="evil">styled</p>',
    '<custom-widget><b>kept content</b></custom-widget>',
    '<a href="https://example.org/ok" target="_blank">good link</a>'
  ].join('')
  await go(`${server.origin}/b`)
  await inMain(
    h.app,
    `
    const id = 'ab'.repeat(16)
    s.reader.articles.set(id, { title: 'Hostile', byline: '', siteName: '', excerpt: '', url: 'https://example.org/page', html: arg, lang: 'en', dir: '', words: 50 })
    s.windows.focused().activeTab.loadUrl('bmax://reader/?id=' + id + '&url=' + encodeURIComponent('https://example.org/page'))
  `,
    hostile
  )
  const p = (await waitFor(async () => pageOf('reader'), (x) => !!x))!
  await expect(p.getByTestId('reader-title')).toHaveText('Hostile')
  await sleep(500)
  const audit = await p.evaluate(() => {
    const b = document.querySelector('[data-testid=reader-body]')!
    return {
      html: b.innerHTML,
      links: Array.from(b.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), text: a.textContent, target: a.getAttribute('target'), rel: a.getAttribute('rel') })),
      imgs: b.querySelectorAll('img').length,
      pwned: (window as unknown as { __pwned?: unknown }).__pwned ?? null
    }
  })
  expect(audit.pwned).toBeNull()
  // Only <img src="x"> survives (a harmless relative URL); javascript:/data:text/html sources and every handler are gone.
  expect(audit.imgs).toBe(1)
  expect(audit.html).not.toMatch(/<script|<iframe|<form|<input|<style|<svg|<math|onerror|onclick|onload|javascript:|style=|class=|id=/i)
  expect(audit.html).toContain('safe text')
  expect(audit.html).toContain('kept content')
  const good = audit.links.find((l) => l.text === 'good link')!
  expect(good.href).toBe('https://example.org/ok')
  expect(good.target).toBeNull()
  expect(good.rel).toBe('noopener noreferrer')
  // Hostile links keep their text but lose the destination.
  for (const l of audit.links.filter((l) => l.text !== 'good link')) expect(l.href).toBeNull()
})

// ---------------------------------------------------------------- tab sleeping

test('background tabs sleep after the idle time, keep their history, and wake when selected', async () => {
  await go(`${server.origin}/`)
  await go(`${server.origin}/b`) // history: / → /b
  await inMain(h.app, `s.windows.focused().openTab(arg, { background: false })`, `${server.origin}/ext-page`)
  await waitFor(() => inMain<boolean>(h.app, `return !s.windows.focused().activeTab.loading`), (v) => v)
  const ids = await inMain<{ first: number; second: number }>(h.app, `const w = s.windows.focused(); return { first: w.tabs[w.tabs.length - 2].id, second: w.activeTab.id }`)

  // Not idle long enough → stays awake. Never touches the active tab.
  expect(await inMain<number>(h.app, `return await s.sleeper.sweep()`)).toBe(0)

  // A tab playing audio is never put to sleep.
  await inMain(h.app, `const w = s.windows.focused(); const t = w.tabById(arg); t.lastActiveAt = Date.now() - 31 * 60000; t.audible = true`, ids.first)
  expect(await inMain<number>(h.app, `return await s.sleeper.sweep()`)).toBe(0)
  await inMain(h.app, `s.windows.focused().tabById(arg).audible = false`, ids.first)

  // Sleeping disabled in settings → no sleeping either.
  await inMain(h.app, `s.settings.update({ general: { ...s.settings.get().general, sleepTabsAfterMin: 0 } })`)
  expect(await inMain<number>(h.app, `return await s.sleeper.sweep()`)).toBe(0)
  await inMain(h.app, `s.settings.update({ general: { ...s.settings.get().general, sleepTabsAfterMin: 30 } })`)

  expect(await inMain<number>(h.app, `return await s.sleeper.sweep()`)).toBe(1)
  // The page is unloaded asynchronously (about:blank replaces it).
  const asleep = await waitFor(
    () =>
      inMain<{ sleeping: boolean; title: string; url: string; wcUrl: string }>(
        h.app,
        `const t = s.windows.focused().tabById(arg); return { sleeping: t.sleeping, title: t.info().title, url: t.url, wcUrl: t.wc.getURL() }`,
        ids.first
      ),
    (v) => v.wcUrl === 'about:blank'
  )
  expect(asleep).toEqual({ sleeping: true, title: 'Page B', url: `${server.origin}/b`, wcUrl: 'about:blank' })
  // The tab strip shows it as sleeping, still with its real title.
  await expect(chromePage().locator('[role=tab][data-sleeping=true]')).toHaveCount(1)
  await screenshot(h.app, 'chrome', 'tab-sleeping.png')

  // Selecting it wakes it: same page, and back/forward history is intact.
  await inMain(h.app, `const w = s.windows.focused(); w.activate(w.tabById(arg))`, ids.first)
  const woke = await waitFor(() => inMain<string>(h.app, `return s.windows.focused().activeTab.wc.getURL()`), (u) => u === `${server.origin}/b`, 8000)
  expect(woke).toBe(`${server.origin}/b`)
  await waitFor(() => inMain<boolean>(h.app, `return !s.windows.focused().activeTab.wc.isLoading()`), (v) => v)
  const awake = await inMain<{ sleeping: boolean; canBack: boolean; canForward: boolean; entries: string[]; title: string }>(
    h.app,
    `const t = s.windows.focused().activeTab; const n = t.wc.navigationHistory; return { sleeping: t.sleeping, canBack: n.canGoBack(), canForward: n.canGoForward(), entries: n.getAllEntries().map((e) => e.url), title: t.wc.getTitle() }`
  )
  expect(awake.sleeping).toBe(false)
  expect(awake.title).toBe('Page B')
  // History is intact (… / → /b), and no blank placeholder is left for Forward to land on.
  expect(awake.canBack).toBe(true)
  expect(awake.canForward).toBe(false)
  expect(awake.entries.slice(-2)).toEqual([`${server.origin}/`, `${server.origin}/b`])
  expect(awake.entries).not.toContain('about:blank')
  await expect(chromePage().locator('[role=tab][data-sleeping=true]')).toHaveCount(0)

  // The manual "Put tab to sleep" action works on a background tab only.
  expect(await inMain<boolean>(h.app, `const w = s.windows.focused(); return w.activeTab.sleep()`)).toBe(false)
  expect(await inMain<boolean>(h.app, `const w = s.windows.focused(); return w.tabById(arg).sleep()`, ids.second)).toBe(true)
})

// ---------------------------------------------------------------- site colour scheme

test('websites see prefers-color-scheme following the browser theme, or the forced choice', async () => {
  await go(`${server.origin}/`)
  const dark = (): Promise<boolean> =>
    inMain<boolean>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches")`)
  await inMain(h.app, `s.settings.update({ theme: 'dark', siteColorScheme: 'follow' })`)
  expect(await waitFor(dark, (v) => v === true)).toBe(true)
  await inMain(h.app, `s.settings.update({ siteColorScheme: 'light' })`)
  expect(await waitFor(dark, (v) => v === false)).toBe(false)
  await inMain(h.app, `s.settings.update({ theme: 'light', siteColorScheme: 'dark' })`)
  expect(await waitFor(dark, (v) => v === true)).toBe(true)
  await inMain(h.app, `s.settings.update({ theme: 'light', siteColorScheme: 'follow' })`)
  expect(await waitFor(dark, (v) => v === false)).toBe(false)
  // New navigations and new tabs keep the emulation.
  await inMain(h.app, `s.settings.update({ siteColorScheme: 'dark' })`)
  await go(`${server.origin}/b`)
  expect(await waitFor(dark, (v) => v === true)).toBe(true)
  await inMain(h.app, `s.settings.update({ theme: 'system', siteColorScheme: 'follow' })`)
})

// ---------------------------------------------------------------- picture-in-picture

test('picture-in-picture toggles for the video on the page', async () => {
  await go(`${media.origin}/media-page`)
  await waitFor(
    () => inMain<number>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("document.getElementById('v').readyState")`),
    (v) => v >= 1
  )
  const opened = await inMain<string>(h.app, `return await s.windows.focused().activeTab.togglePictureInPicture()`)
  expect(opened).toBe('opened')
  expect(await inMain<boolean>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("!!document.pictureInPictureElement")`)).toBe(true)
  // A tab in picture-in-picture is "in use" and must not be slept.
  expect(await inMain<boolean>(h.app, `return await s.windows.focused().activeTab.hasPictureInPicture()`)).toBe(true)
  const closed = await inMain<string>(h.app, `return await s.windows.focused().activeTab.togglePictureInPicture()`)
  expect(closed).toBe('closed')
  expect(await inMain<boolean>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("!!document.pictureInPictureElement")`)).toBe(false)
  // No video → nothing happens.
  await go(`${server.origin}/b`)
  expect(await inMain<string>(h.app, `return await s.windows.focused().activeTab.togglePictureInPicture()`)).toBe('none')
})
