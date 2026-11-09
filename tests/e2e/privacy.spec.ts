import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'
import { startSocks } from './socks'

let h: Harness
let srv: TestServer

test.beforeAll(async () => {
  srv = await startServer()
  h = await launch({}, ['--host-resolver-rules=MAP *.example 127.0.0.1'])
  // The a.example / b.example hosts are public-looking names; HTTPS-Only is tested separately.
  await setPrivacy({ httpsOnly: false })
})
test.afterAll(async () => {
  await h.close()
  await srv.close()
})

async function setPrivacy(patch: Record<string, unknown>): Promise<void> {
  await inMain(h.app, `s.settings.update({ privacy: { ...s.settings.get().privacy, ...arg } })`, patch)
}
async function go(url: string): Promise<void> {
  await inMain(h.app, `s.windows.focused().go(arg)`, url)
  await sleep(150)
  for (let i = 0; i < 80; i++) {
    const done = await inMain<boolean>(h.app, `const t = s.windows.focused().activeTab; return !t.loading && t.wc.getURL() !== ''`)
    if (done) break
    await sleep(100)
  }
  await sleep(200)
}
const js = <T>(code: string): Promise<T> =>
  inMain<T>(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript(arg)`, code)
const body = (): Promise<string> => js<string>('document.body.innerText')
const tabUrl = (): Promise<string> => inMain(h.app, 'return s.windows.focused().activeTab.url')
const tabTitle = (): Promise<string> => inMain(h.app, 'return s.windows.focused().activeTab.title')
async function resetTabs(): Promise<void> {
  await inMain(h.app, `const w = s.windows.focused(); for (const t of [...w.tabs].slice(1)) w.closeTab(t); w.activate(w.tabs[0])`)
  await go('bmax://newtab')
}

test.describe('request privacy', () => {
  test('sends uniform headers: generic UA, GPC, no DNT, minimal client hints, uniform language', async () => {
    await resetTabs()
    await go(`${srv.a}/headers`)
    const headers = JSON.parse(await body()) as Record<string, string>
    const major = await inMain<number>(h.app, 'return Number(process.versions.chrome.split(".")[0])')
    expect(headers['user-agent']).toBe(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
    )
    expect(headers['user-agent']).not.toMatch(/Electron|bmax/i)
    expect(headers['sec-gpc']).toBe('1')
    expect(headers['dnt']).toBeUndefined()
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"')
    expect(headers['sec-ch-ua-mobile']).toBe('?0')
    expect(Object.keys(headers).filter((k) => /sec-ch-ua-(full|arch|model|bitness|wow64|platform-version)/.test(k))).toEqual([])
    expect(headers['accept-language']).toBe('en-US,en;q=0.9')
  })

  test('strips tracking parameters from top-level navigations', async () => {
    await go(`${srv.a}/b?utm_source=news&fbclid=abc&keep=1&gclid=2&mc_eid=3&igshid=4`)
    expect(await tabUrl()).toBe(`${srv.a}/b?keep=1`)
    expect(await tabTitle()).toBe('Page B')
  })

  test('trims cross-site referrers to the origin', async () => {
    await go(`${srv.a}/ref`)
    await inMain(h.app, 's.windows.focused().activeTab.lastGestureAt = Date.now()') // a real click would count as a gesture
    await js("document.getElementById('x').click()")
    await sleep(800)
    const headers = JSON.parse(await body()) as Record<string, string>
    expect(headers['referer']).toBe(`${srv.a}/`)
  })

  test('blocks third-party cookies (header and document.cookie) but allows first-party ones', async () => {
    await go(`${srv.a}/embed`)
    await sleep(800)
    const frameCookie = await inMain<string>(
      h.app,
      `const f = s.windows.focused().activeTab.wc.mainFrame.frames[0]; return f ? await f.executeJavaScript('document.cookie') : 'no-frame'`
    )
    expect(frameCookie).toBe('') // third-party frame has no cookie jar
    await go(`${srv.b}/echo`)
    expect(await body()).toBe('') // nothing from the third-party context was stored for b.example
    // First-party cookies still work.
    await go(`${srv.b}/setcookie`)
    await go(`${srv.b}/echo`)
    expect(await body()).toContain('tp=1')
  })

  test('blocks third-party beacons / pings but allows first-party ones', async () => {
    await go(`${srv.a}/b`)
    const before = srv.beacons()
    await js(`navigator.sendBeacon('${srv.b}/beacon', 'x'); 1`)
    await sleep(700)
    expect(srv.beacons()).toBe(before) // third party: blocked
    await js(`navigator.sendBeacon('${srv.a}/beacon', 'x'); 1`)
    await sleep(700)
    expect(srv.beacons()).toBe(before + 1) // first party: allowed
  })

  test('HTTPS-Only: failed upgrade shows a warning, "continue" loads over HTTP for that host only', async () => {
    await setPrivacy({ httpsOnly: true })
    try {
      await go(`${srv.a}/b`)
      for (let i = 0; i < 50 && (await tabTitle()) !== 'Connection not secure'; i++) await sleep(150)
      expect(await tabTitle()).toBe('Connection not secure')
      expect(await tabUrl()).toBe(`${srv.a}/b`) // the address bar keeps the original http URL
      // The user explicitly chooses to continue (page → main command, role-checked).
      await inMain(h.app, `return await s.windows.focused().activeTab.wc.executeJavaScript("window.bmax.cmd('warning.proceedHttp', { url: '${srv.a}/b' })")`)
      for (let i = 0; i < 50 && (await tabTitle()) !== 'Page B'; i++) await sleep(150)
      expect(await tabTitle()).toBe('Page B')
      // Local addresses are never upgraded.
      await go(`${srv.origin}/b`)
      expect(await tabTitle()).toBe('Page B')
    } finally {
      await setPrivacy({ httpsOnly: false })
    }
  })
})

test.describe('fingerprinting protection', () => {
  const CANVAS = `(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 40; const x = c.getContext('2d');
    x.fillStyle = '#f60'; x.fillRect(5, 5, 60, 25); x.fillStyle = '#069'; x.font = '16px Arial'; x.fillText('bmax fp test', 8, 28);
    x.beginPath(); x.arc(90, 20, 14, 0, 7); x.stroke(); return c.toDataURL() })()`

  test('canvas: stable within a site, different across sites, different from the unprotected value', async () => {
    await go(`${srv.a}/b`)
    const a1 = await js<string>(CANVAS)
    await go(`${srv.a}/frame`)
    const a2 = await js<string>(CANVAS)
    await go(`${srv.b}/b`)
    const b1 = await js<string>(CANVAS)
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b1)
    await setPrivacy({ fingerprintProtection: false })
    await go(`${srv.a}/b`)
    const raw = await js<string>(CANVAS)
    await setPrivacy({ fingerprintProtection: true })
    expect(raw).not.toBe(a1)
    expect(raw).not.toBe(b1)
  })

  test('navigator surface is uniform and rare APIs are removed', async () => {
    await go(`${srv.alt}/b`) // localhost is a secure context, so navigator.userAgentData exists
    const r = await js<Record<string, unknown>>(`(async () => ({
      hc: navigator.hardwareConcurrency, mem: navigator.deviceMemory, platform: navigator.platform, lang: navigator.languages.join(','),
      battery: typeof navigator.getBattery, conn: typeof navigator.connection, gpc: navigator.globalPrivacyControl,
      uadPlatform: navigator.userAgentData && navigator.userAgentData.platform,
      uadArch: navigator.userAgentData && (await navigator.userAgentData.getHighEntropyValues(['architecture'])).architecture,
      toString: Function.prototype.toString.call(navigator.__lookupGetter__ ? Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get : function(){}),
      ua: navigator.userAgent
    }))()`)
    expect(r['hc']).toBe(4)
    expect(r['mem']).toBe(8)
    expect(r['platform']).toBe('Win32')
    expect(r['lang']).toBe('en-US,en')
    expect(r['battery']).toBe('undefined')
    expect(r['conn']).toBe('undefined')
    expect(r['gpc']).toBe(true)
    expect(r['uadPlatform']).toBe('Windows')
    expect(r['uadArch']).toBe('x86')
    expect(String(r['toString'])).toContain('[native code]')
    expect(String(r['ua'])).not.toMatch(/Electron/)
  })

  test('WebRTC cannot reveal local or public IP addresses', async () => {
    await go(`${srv.a}/b`)
    const candidates = await js<string[]>(`new Promise((resolve) => {
      const out = []; const pc = new RTCPeerConnection({ iceServers: [] }); pc.createDataChannel('x');
      pc.onicecandidate = (e) => { if (e.candidate) out.push(e.candidate.candidate); else resolve(out) };
      pc.createOffer().then((o) => pc.setLocalDescription(o));
      setTimeout(() => resolve(out), 4000)
    })`)
    const leaks = candidates.filter((c) => /\b(\d{1,3}\.){3}\d{1,3}\b/.test(c) && !/typ relay/.test(c))
    expect(leaks).toEqual([])
  })
})

test.describe('containers, burn, proxy', () => {
  test('container tabs have their own storage and are wiped when closed', async () => {
    await resetTabs()
    await go(`${srv.a}/b`)
    await js(`localStorage.setItem('k', 'shared'); document.cookie = 'who=shared; path=/'; 1`)
    await inMain(h.app, `const w = s.windows.focused(); w.openTab('${srv.a}/b', { partition: s.sessions.newContainerPartition() })`)
    await sleep(1200)
    const container = await inMain<{ partition: string; ls: string | null; cookie: string }>(
      h.app,
      `const t = s.windows.focused().activeTab; return { partition: t.partition, ls: await t.wc.executeJavaScript("localStorage.getItem('k')"), cookie: await t.wc.executeJavaScript('document.cookie') }`
    )
    expect(container.partition).toMatch(/^bmax-ctr-/)
    expect(container.ls).toBeNull()
    expect(container.cookie).toBe('')
    await inMain(h.app, `s.windows.focused().activeTab.wc.executeJavaScript("localStorage.setItem('k', 'container'); 1")`)
    // back in the shared session nothing changed
    await inMain(h.app, `const w = s.windows.focused(); w.activate(w.tabs[0])`)
    expect(await js<string>(`localStorage.getItem('k')`)).toBe('shared')
    // closing the only tab of the container wipes and forgets its session
    await inMain(h.app, `const w = s.windows.focused(); w.closeTab(w.tabs[1])`)
    await sleep(500)
    expect(await inMain<string[]>(h.app, 'return s.sessions.partitions()')).not.toContainEqual(expect.stringMatching(/^bmax-ctr-/))
  })

  test('Burn wipes storage, closes everything and leaves one fresh window', async () => {
    await resetTabs()
    await go(`${srv.a}/b`)
    await js(`localStorage.setItem('burn', 'me'); document.cookie = 'burn=me; path=/'; 1`)
    await inMain(h.app, `s.windows.focused().openTab('${srv.a}/frame'); s.windows.create({ url: '${srv.a}/b' })`)
    await sleep(800)
    expect(await inMain<number>(h.app, 'return s.windows.all().length')).toBe(2)
    await inMain(h.app, `await s.windows.burn()`)
    await sleep(800)
    const after = await inMain<{ windows: number; tabs: number; url: string; closed: string | undefined }>(
      h.app,
      `const w = s.windows.focused(); return { windows: s.windows.all().length, tabs: w.tabs.length, url: w.activeTab.url, closed: s.windows.popClosed() }`
    )
    expect(after.windows).toBe(1)
    expect(after.tabs).toBe(1)
    expect(after.url).toBe('bmax://newtab/')
    expect(after.closed).toBeUndefined() // Ctrl+Shift+T history forgotten too
    await go(`${srv.a}/b`)
    expect(await js<string | null>(`localStorage.getItem('burn')`)).toBeNull()
    expect(await js<string>('document.cookie')).toBe('')
  })

  test('user proxy: traffic goes through the proxy with the hostname (remote DNS); a dead proxy fails closed', async () => {
    await resetTabs()
    const socks = await startSocks(srv.port)
    try {
      await inMain(h.app, `s.settings.update({ proxy: { enabled: true, scheme: 'socks5', host: '127.0.0.1', port: arg } })`, socks.port)
      await sleep(500)
      await go(`http://proxied.test-site.example:${srv.port}/b`)
      expect(await tabTitle()).toBe('Page B')
      expect(socks.hosts).toContain('proxied.test-site.example')

      // Fail closed: proxy enabled but nothing listening → the page must NOT load directly.
      await inMain(h.app, `s.settings.update({ proxy: { enabled: true, scheme: 'socks5', host: '127.0.0.1', port: 1 } })`)
      await sleep(500)
      await go(`${srv.a}/b?x=1`)
      await sleep(500)
      expect(await tabTitle()).toBe("Can't reach this page")
    } finally {
      await inMain(h.app, `s.settings.update({ proxy: { enabled: false, scheme: 'socks5', host: '127.0.0.1', port: 1080 } })`)
      await socks.close()
      await sleep(500)
    }
    await go(`${srv.a}/b?y=1`)
    expect(await tabTitle()).toBe('Page B')
  })
})

test('settings: DoH configuration applies without error and persists', async () => {
  await inMain(h.app, `s.settings.update({ privacy: { ...s.settings.get().privacy, doh: { mode: 'secure', provider: 'mullvad', customUrl: '' } } })`)
  await inMain(h.app, `s.settings.update({ privacy: { ...s.settings.get().privacy, doh: { mode: 'secure', provider: 'custom', customUrl: 'not a url' } } })`)
  await inMain(h.app, `s.settings.update({ privacy: { ...s.settings.get().privacy, doh: { mode: 'secure', provider: 'quad9', customUrl: '' } } })`)
  await inMain(h.app, `s.settings.flush()`)
  const saved = JSON.parse(readFileSync(join(h.userData, 'settings.json'), 'utf8')) as { privacy?: { doh?: { provider?: string } } }
  expect(saved.privacy?.doh?.provider).toBe('quad9')
})
