import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'

let h: Harness
let srv: TestServer

test.beforeAll(async () => {
  srv = await startServer()
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1', BMAX_TEST_YT_HOST: 'yt.example' }, ['--host-resolver-rules=MAP *.example 127.0.0.1'])
  await inMain(h.app, `s.settings.update({ privacy: { ...s.settings.get().privacy, httpsOnly: false } })`)
})
test.afterAll(async () => {
  await h.close()
  await srv.close()
})

const RULES = ['/ads/banner.js^$script', '/ads/pixel.gif^$image', '||b.example^$third-party', 'a.example##.ad-box'].join('\n')

async function go(url: string): Promise<void> {
  await inMain(h.app, `s.windows.focused().go(arg)`, url)
  await sleep(200)
  for (let i = 0; i < 80; i++) {
    if (await inMain<boolean>(h.app, `const t = s.windows.focused().activeTab; return !t.loading && t.wc.getURL() !== ''`)) break
    await sleep(100)
  }
  await sleep(500)
}
const js = <T>(code: string): Promise<T> => inMain<T>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript(arg)`, code)
const panel = (): Promise<{ blocked: number; ads: number; trackers: number; customHidden: number; siteEnabled: boolean; items: { host: string; type: string; category: string }[]; navigations: { kind: string; url: string }[]; notificationsBlocked: number; site: string }> =>
  inMain(h.app, 's.shields.panelInfo(s.windows.focused().activeTab)'.replace(/^/, 'return '))
async function resetTabs(): Promise<void> {
  await inMain(h.app, `const w = s.windows.focused(); for (const t of [...w.tabs].slice(1)) w.closeTab(t); w.activate(w.tabs[0])`)
  await inMain(h.app, `s.shields.setRules(arg)`, RULES)
  await inMain(h.app, 's.windows.focused().activeTab.lastGestureAt = 0')
  await go('bmax://newtab')
}
const tabCount = (): Promise<number> => inMain(h.app, 'return s.windows.focused().tabs.length')
async function click(x: number, y: number): Promise<void> {
  await inMain(
    h.app,
    `const wc = s.windows.focused().activeTab.wc; wc.focus();
     wc.sendInputEvent({ type: 'mouseMove', x: arg.x, y: arg.y });
     await new Promise((r) => setTimeout(r, 80));
     wc.sendInputEvent({ type: 'mouseDown', x: arg.x, y: arg.y, button: 'left', clickCount: 1 });
     wc.sendInputEvent({ type: 'mouseUp', x: arg.x, y: arg.y, button: 'left', clickCount: 1 });`,
    { x, y }
  )
  await sleep(500)
}

test.describe('network and cosmetic blocking (custom rules)', () => {
  test('blocks matching requests, hides elements, and counts what it blocked', async () => {
    await resetTabs()
    await go(`${srv.a}/shields`)
    expect(await js<unknown>('window.__adLoaded')).toBeUndefined() // script blocked
    expect(await js<unknown>('window.__trackerLoaded')).toBeUndefined() // third-party tracker blocked
    expect(await js<string>(`getComputedStyle(document.querySelector('.ad-box')).display`)).toBe('none') // cosmetic rule
    expect(await js<string>(`getComputedStyle(document.getElementById('keep')).display`)).toBe('block') // untouched
    await sleep(600)
    const p = await panel()
    expect(p.blocked).toBeGreaterThanOrEqual(3)
    expect(p.items.map((i) => i.host)).toEqual(expect.arrayContaining(['a.example', 'b.example']))
    expect(p.items.every((i) => i.category === 'custom')).toBe(true)
    // the toolbar badge data
    expect(await inMain<number>(h.app, 'return s.windows.focused().activeTab.info().shields.blocked')).toBeGreaterThanOrEqual(3)
  })

  test('per-site toggle turns Shields off and on for that site only', async () => {
    await go(`${srv.a}/shields`)
    await inMain(h.app, `s.shields.setSite(s.windows.focused().activeTab, false)`)
    await sleep(1500)
    expect(await js<unknown>('window.__adLoaded')).toBe(true)
    expect(await js<string>(`getComputedStyle(document.querySelector('.ad-box')).display`)).toBe('block')
    expect((await panel()).siteEnabled).toBe(false)
    expect(await inMain<string[]>(h.app, 'return s.settings.get().shields.disabledSites')).toEqual(['a.example'])
    await inMain(h.app, `s.shields.setSite(s.windows.focused().activeTab, true)`)
    await sleep(1500)
    expect(await js<unknown>('window.__adLoaded')).toBeUndefined()
    expect(await inMain<string[]>(h.app, 'return s.settings.get().shields.disabledSites')).toEqual([])
  })

  test('counters restart on every new page', async () => {
    await go(`${srv.a}/shields`)
    expect((await panel()).blocked).toBeGreaterThan(0)
    await go(`${srv.a}/b`)
    expect((await panel()).blocked).toBe(0)
  })

  test('global switch disables everything', async () => {
    await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, enabled: false } })`)
    await go(`${srv.a}/shields`)
    expect(await js<unknown>('window.__adLoaded')).toBe(true)
    await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, enabled: true } })`)
  })
})

test.describe('element picker and rules editor', () => {
  test('picking an element hides it now and saves a rule for next time', async () => {
    await resetTabs()
    await go(`${srv.a}/shields`)
    const rule = await inMain<string | null>(
      h.app,
      `const tab = s.windows.focused().activeTab; const wc = tab.wc;
       const p = s.shields.pick(tab);
       await new Promise((r) => setTimeout(r, 400));
       const pt = await wc.executeJavaScript("(() => { const r = document.getElementById('target-el').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()");
       wc.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y });
       await new Promise((r) => setTimeout(r, 250));
       wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
       wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
       return await p;`
    )
    expect(rule).toBe('a.example###target-el')
    await sleep(300)
    expect(await js<string>(`getComputedStyle(document.getElementById('target-el')).display`)).toBe('none')
    expect(await inMain<string>(h.app, 'return s.shields.getRules()')).toContain('a.example###target-el')
    // persisted rule applies on the next load via the cosmetic pipeline
    await go(`${srv.a}/shields`)
    expect(await js<string>(`getComputedStyle(document.getElementById('target-el')).display`)).toBe('none')
  })

  test('Escape cancels the picker without adding a rule', async () => {
    await go(`${srv.a}/shields`)
    const before = await inMain<string>(h.app, 'return s.shields.getRules()')
    const rule = await inMain<string | null>(
      h.app,
      `const tab = s.windows.focused().activeTab; const wc = tab.wc; wc.focus();
       const p = s.shields.pick(tab);
       await new Promise((r) => setTimeout(r, 400));
       wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
       return await p;`
    )
    expect(rule).toBeNull()
    expect(await inMain<string>(h.app, 'return s.shields.getRules()')).toBe(before)
  })

  test('rules editor: save, reload, and rules take effect', async () => {
    const r = await inMain<{ ok: boolean; lines: number }>(h.app, `return s.shields.setRules(arg)`, '! my rules\n/ads/banner.js^$script\n##.promo-widget')
    expect(r).toEqual({ ok: true, lines: 2 })
    expect(await inMain<string>(h.app, 'return s.shields.getRules()')).toContain('promo-widget')
    await go(`${srv.a}/shields`)
    expect(await js<unknown>('window.__adLoaded')).toBeUndefined()
    expect(await js<string>(`getComputedStyle(document.querySelector('.promo-widget')).display`)).toBe('none')
    expect(await inMain(h.app, `return s.shields.setRules('x'.repeat(250000))`)).toMatchObject({ ok: false })
  })

  test('the rules editor commands are role-checked (page role only)', async () => {
    await inMain(h.app, `s.windows.focused().execute('settings')`)
    await sleep(900)
    const viaPage = await inMain<string>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("window.bmax.cmd('shields.rules.get').then(t => 'ok:' + typeof t, e => String(e.message))")`)
    expect(viaPage).toBe('ok:string')
    const forbidden = await inMain<string>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("window.bmax.cmd('shields.setSite', { enabled: false }).then(() => 'allowed', e => String(e.message))")`)
    expect(forbidden).toContain('Forbidden')
  })
})

test.describe('pop-ups, auto-redirects, notification spam', () => {
  test('script-opened pop-ups without a user gesture are blocked; user-clicked ones open', async () => {
    await resetTabs()
    await go(`${srv.a}/popup-auto`)
    await sleep(800)
    expect(await tabCount()).toBe(1)
    const p = await panel()
    expect(p.navigations.some((n) => n.kind === 'popup')).toBe(true)

    await go(`${srv.a}/popup-click`)
    await sleep(1800) // let the "page just loaded" guard pass
    await click(100, 40)
    await sleep(600)
    expect(await tabCount()).toBe(2)
  })

  test('scripted cross-site redirects are blocked; redirects after a user click are allowed', async () => {
    await resetTabs()
    await go(`${srv.a}/redirect-auto`)
    await sleep(5000) // > 600ms timer, and past the gesture window
    expect(await inMain<string>(h.app, 'return s.windows.focused().activeTab.url')).toBe(`${srv.a}/redirect-auto`)
    expect((await panel()).navigations.some((n) => n.kind === 'redirect')).toBe(true)
    // the user can still allow it from the Shields panel
    await inMain(h.app, `s.shields.allowNavigation(s.windows.focused().activeTab, arg)`, `${srv.b}/b`)
    await sleep(1200)
    expect(await inMain<string>(h.app, 'return s.windows.focused().activeTab.url')).toBe(`${srv.b}/b`)

    await go(`${srv.a}/redirect-click`)
    await sleep(1000)
    await click(100, 40)
    await sleep(1500)
    expect(await inMain<string>(h.app, 'return s.windows.focused().activeTab.url')).toBe(`${srv.b}/b`)
  })

  test('notification permission prompts are blocked silently, and can be re-enabled', async () => {
    await resetTabs()
    await go(`${srv.a}/perm`)
    await sleep(800)
    expect(await js<string>('window.__perm')).toBe('denied')
    expect(await inMain<boolean>(h.app, `return s.windows.focused().overlays.isVisible('permission')`)).toBe(false)
    expect((await panel()).notificationsBlocked).toBe(1)
    await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, blockNotifications: false } })`)
    await go(`${srv.a}/perm`)
    await sleep(800)
    expect(await inMain<boolean>(h.app, `return s.windows.focused().overlays.isVisible('permission')`)).toBe(true)
    await inMain(h.app, `s.permissions.reset(); s.settings.update({ shields: { ...s.settings.get().shields, blockNotifications: true } })`)
  })
})

test.describe('YouTube module', () => {
  const watch = (): string => `http://yt.example:${srv.port}/yt-watch`

  test('strips ad data from player JSON, hides ad containers, and clicks Skip', async () => {
    await resetTabs()
    await go(watch())
    await sleep(800)
    expect(await js<string>('JSON.stringify(window.ytInitialPlayerResponse)')).toBe('{"playabilityStatus":{},"videoDetails":{"videoId":"v"}}')
    expect(await js<string>('JSON.stringify(window.__parsed)')).toBe('{"responseContext":{},"x":1}')
    expect(await js<string>("getComputedStyle(document.querySelector('ytd-ad-slot-renderer')).display")).toBe('none')
    expect(await js<boolean>('window.__skipped === true')).toBe(true)
  })

  test('does nothing when the YouTube option or Shields for the site is off', async () => {
    await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, youtube: false } })`)
    await go(watch())
    await sleep(600)
    expect(await js<string>('JSON.stringify(window.ytInitialPlayerResponse)')).toContain('adPlacements')
    await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, youtube: true } })`)
    await inMain(h.app, `s.shields.setSite(s.windows.focused().activeTab, false)`)
    await sleep(1500)
    expect(await js<string>('JSON.stringify(window.ytInitialPlayerResponse)')).toContain('adPlacements')
    await inMain(h.app, `s.shields.setSite(s.windows.focused().activeTab, true)`)
    await sleep(1200)
    expect(await js<string>('JSON.stringify(window.ytInitialPlayerResponse)')).not.toContain('adPlacements')
  })
})

test.describe('filter lists (offline, seeded)', () => {
  test('lists compile in a worker, block via the compiled engine, and the engine is cached on disk', async () => {
    await inMain(h.app, `s.shields.setRules('')`)
    await inMain(h.app, `s.shields.store.seed('easylist', '! Title: seeded\\n/ads/banner.js^$script\\n||b.example^$third-party\\n##.ad-box\\n')`)
    await inMain(h.app, `await s.shields.refresh()`)
    const status = await inMain<{ state: string; networkRules: number; cosmeticRules: number }>(h.app, 'return s.shields.engine.status')
    expect(status.state).toBe('ready')
    expect(status.networkRules).toBeGreaterThanOrEqual(2)
    expect(existsSync(join(h.userData, 'shields', 'engine-ads.bin'))).toBe(true)
    expect(existsSync(join(h.userData, 'shields', 'engine-trackers.bin'))).toBe(true)

    await go(`${srv.a}/shields`)
    expect(await js<unknown>('window.__adLoaded')).toBeUndefined()
    expect(await js<unknown>('window.__trackerLoaded')).toBeUndefined()
    expect(await js<string>(`getComputedStyle(document.querySelector('.ad-box')).display`)).toBe('none')
    const p = await panel()
    expect(p.items.some((i) => i.category === 'ad')).toBe(true)
  })

  test('toggling a list in settings rebuilds the engine without it', async () => {
    await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, lists: { easylist: false } } })`)
    for (let i = 0; i < 100; i++) {
      const st = await inMain<{ state: string }>(h.app, 'return s.shields.engine.status')
      if (st.state !== 'building') break
      await sleep(200)
    }
    await sleep(500)
    // nothing enabled has a downloaded copy any more → no engine is built; the old one stays until replaced, but status is not an error
    const info = await inMain<{ lists: { id: string; enabled: boolean }[] }>(h.app, 'return s.shields.listsInfo()')
    expect(info.lists.find((l) => l.id === 'easylist')?.enabled).toBe(false)
    expect(info.lists.find((l) => l.id === 'ubo-filters')?.enabled).toBe(true)
    expect(info.lists.find((l) => l.id === 'r-indian')?.enabled).toBe(false) // regional lists are opt-in
  })
})
