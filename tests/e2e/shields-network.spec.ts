import { expect, test } from '@playwright/test'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'

/**
 * Opt-in tests against the REAL filter lists and public ad-test pages. They need internet access:
 *   BMAX_NETWORK=1 npx playwright test shields-network
 * (the d3ward test page named in the brief is archived and no longer runs a test, so canyoublockit.com and adblock-tester.com are used.)
 */
test.skip(process.env['BMAX_NETWORK'] !== '1', 'set BMAX_NETWORK=1 to run against the live internet')
test.setTimeout(240_000)

let h: Harness
test.beforeAll(async () => {
  h = await launch()
  for (let i = 0; i < 180; i++) {
    const st = await inMain<{ state: string; message: string }>(h.app, 'return s.shields.engine.status')
    if (st.state === 'ready') return
    if (st.state === 'error') throw new Error(st.message)
    await sleep(1000)
  }
  throw new Error('engine never became ready')
})
test.afterAll(async () => {
  await h.close()
})

async function load(url: string, shieldsOn: boolean, waitMs = 15_000): Promise<{ blocked: number; text: string }> {
  await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, enabled: arg } })`, shieldsOn)
  await inMain(h.app, 's.windows.focused().go(arg)', url)
  await sleep(waitMs)
  const text = await inMain<string>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript('document.body ? document.body.innerText : ""')`)
  const p = await inMain<{ blocked: number }>(h.app, 'return s.shields.panelInfo(s.windows.focused().activeTab)')
  return { blocked: p.blocked, text }
}

test('the default lists build a real engine', async () => {
  const st = await inMain<{ networkRules: number; cosmeticRules: number }>(h.app, 'return s.shields.engine.status')
  expect(st.networkRules).toBeGreaterThan(100_000)
  expect(st.cosmeticRules).toBeGreaterThan(50_000)
  const info = await inMain<{ lists: { id: string; enabled: boolean; fetchedAt: number }[] }>(h.app, 'return s.shields.listsInfo()')
  for (const l of info.lists.filter((x) => x.enabled)) expect(l.fetchedAt, l.id).toBeGreaterThan(0)
})

test('canyoublockit.com: requests are blocked with Shields on, none with it off', async () => {
  const on = await load('https://canyoublockit.com/testing/', true)
  const off = await load('https://canyoublockit.com/testing/', false)
  console.log(`canyoublockit blocked: on=${on.blocked} off=${off.blocked}`)
  expect(on.blocked).toBeGreaterThanOrEqual(5)
  expect(off.blocked).toBe(0)
})

test('adblock-tester.com: more checks pass with Shields on', async () => {
  const on = await load('https://adblock-tester.com/', true, 20_000)
  const off = await load('https://adblock-tester.com/', false, 20_000)
  const passed = (t: string): number => (t.match(/test passed/g) ?? []).length
  console.log(`adblock-tester: on passed=${passed(on.text)} blocked=${on.blocked}; off passed=${passed(off.text)} blocked=${off.blocked}`)
  expect(on.blocked).toBeGreaterThanOrEqual(15)
  expect(passed(on.text)).toBeGreaterThan(passed(off.text))
})

test('canyoublockit extreme test: no pop-up tab opens when clicking the page', async () => {
  await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, enabled: true } })`)
  await inMain(h.app, 's.windows.focused().go(arg)', 'https://canyoublockit.com/extreme-test/')
  await sleep(12_000)
  const tabsBefore = await inMain<number>(h.app, 'return s.windows.focused().tabs.length')
  await inMain(
    h.app,
    `const wc = s.windows.focused().activeTab.wc; wc.focus();
     wc.sendInputEvent({ type: 'mouseMove', x: 300, y: 300 }); wc.sendInputEvent({ type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 })`
  )
  await sleep(4000)
  const tabsAfter = await inMain<number>(h.app, 'return s.windows.focused().tabs.length')
  expect(tabsAfter).toBe(tabsBefore)
})

test('YouTube: the player response carries no ad data while the video data is intact', async () => {
  await inMain(h.app, `s.settings.update({ shields: { ...s.settings.get().shields, enabled: true, youtube: true } })`)
  await inMain(h.app, 's.windows.focused().go(arg)', 'https://www.youtube.com/watch?v=jNQXAC9IAQE')
  await sleep(15_000)
  const r = await inMain<{ has: boolean; ads: string[]; streaming: boolean; url: string; removed: number; status: string }>(
    h.app,
    `const wc = s.windows.focused().activeTab.wc;
     return { url: wc.getURL(), ...(await wc.executeJavaScript("(() => { const p = window.ytInitialPlayerResponse; if (!p) return { has: false, ads: [], streaming: false, removed: 0, status: '' }; return { has: true, ads: ['adPlacements','playerAds','adSlots'].filter((k) => k in p), streaming: !!p.streamingData, removed: window.__bmaxYoutubeRemoved, status: p.playabilityStatus && p.playabilityStatus.status } })()")) }`
  )
  console.log('youtube probe:', JSON.stringify(r))
  // The module must be active on the real site (its removal counter exists)…
  expect(typeof r.removed).toBe('number')
  // …but YouTube often answers an unsigned, automated client with an error / bot-check response (status !== OK) that carries no
  // playable video, so ad removal can only be asserted when a normal playable response was served.
  test.skip(r.status !== 'OK', `YouTube served playabilityStatus=${r.status}; no playable response to check`)
  expect(r.ads).toEqual([])
  expect(r.streaming).toBe(true)
})
