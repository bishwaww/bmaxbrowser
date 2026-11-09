import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'

const ONION = 'bmaxtestonionaddress.onion'

test.describe('Tor window (fake tor binary)', () => {
  let h: Harness
  let srv: TestServer
  let logDir: string
  let logFile: string
  const log = (): string => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')

  test.beforeAll(async () => {
    srv = await startServer()
    logDir = mkdtempSync(join(tmpdir(), 'bmax-fake-tor-'))
    logFile = join(logDir, 'tor.log')
    h = await launch({
      BMAX_TOR_FAKE: resolve(__dirname, 'fake-tor.cjs'),
      FAKE_TOR_TARGET: String(srv.port),
      FAKE_TOR_LOG: logFile,
      FAKE_TOR_STEP_MS: '900'
    })
  })
  test.afterAll(async () => {
    await h.close()
    await srv.close()
    rmSync(logDir, { recursive: true, force: true })
  })

  const torWin = `s.windows.all().find((w) => w.tor)`
  const tabTitle = (): Promise<string> => inMain(h.app, `return ${torWin}.activeTab.title`)
  async function torGo(url: string): Promise<void> {
    await inMain(h.app, `${torWin}.go(arg)`, url)
    await sleep(200)
    for (let i = 0; i < 60; i++) {
      if (!(await inMain<boolean>(h.app, `return ${torWin}.activeTab.loading`))) break
      await sleep(100)
    }
    await sleep(300)
  }
  async function waitReady(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (await inMain<boolean>(h.app, 'return s.tor.isReady()')) return
      await sleep(100)
    }
    throw new Error('fake tor never became ready')
  }

  test('fails closed: nothing is requested and nothing leaves until Tor is connected', async () => {
    await inMain(h.app, 'await s.windows.createTor()')
    await sleep(300)
    expect(await inMain<boolean>(h.app, `return !!${torWin}`)).toBe(true)
    expect(await tabTitle()).toBe('Connecting to Tor')
    expect(await inMain<boolean>(h.app, 'return s.tor.isReady()')).toBe(false)

    // Try to browse before Tor is up: the request is cancelled in the pipeline and never reaches any proxy.
    await torGo(`http://${ONION}:${srv.port}/b`)
    expect(await tabTitle()).toBe("Can't reach this page")
    expect(log()).not.toContain('SOCKS')
  })

  test('after bootstrap, pages load through the SOCKS proxy using hostnames (no local DNS)', async () => {
    await waitReady()
    expect(log()).toContain('BOOT 100')
    await torGo(`http://${ONION}:${srv.port}/b`)
    expect(await tabTitle()).toBe('Page B')
    expect(log()).toContain(`SOCKS DOMAIN ${ONION}:${srv.port}`)
    expect(log()).not.toMatch(/SOCKS IP/)
  })

  test('Tor windows block the local network, even through Tor', async () => {
    const before = log().split('\n').filter((l) => l.startsWith('SOCKS')).length
    await torGo(`${srv.origin}/b`)
    expect(await tabTitle()).toBe("Can't reach this page")
    await torGo(`${srv.alt}/b`)
    expect(await tabTitle()).toBe("Can't reach this page")
    expect(log().split('\n').filter((l) => l.startsWith('SOCKS')).length).toBe(before)
  })

  test('strict mode: HTTPS-Only is forced, WebRTC is gone, permissions are denied, theme is purple', async () => {
    // HTTP to a normal host is upgraded; the upgrade fails against the plain-HTTP fake server → warning page.
    await torGo(`http://plain.example:${srv.port}/b`)
    for (let i = 0; i < 30 && (await tabTitle()) !== 'Connection not secure'; i++) await sleep(150)
    expect(await tabTitle()).toBe('Connection not secure')

    await torGo(`http://${ONION}:${srv.port}/perm`)
    await sleep(500)
    const probe = await inMain<{ rtc: string; perm: string; gpc: boolean }>(
      h.app,
      `const wc = ${torWin}.activeTab.wc; return { rtc: await wc.executeJavaScript('typeof RTCPeerConnection'), perm: await wc.executeJavaScript('window.__perm'), gpc: await wc.executeJavaScript('navigator.globalPrivacyControl') }`
    )
    expect(probe.rtc).toBe('undefined')
    expect(probe.perm).toBe('denied')
    expect(probe.gpc).toBe(true)
    const ui = await inMain<{ theme: string; tor: boolean; overlay: boolean }>(
      h.app,
      `const w = ${torWin}; return { theme: await w.chromeView.webContents.executeJavaScript('document.documentElement.dataset.theme'), tor: w.state().tor, overlay: w.overlays.isVisible('permission') }`
    )
    expect(ui.theme).toBe('tor')
    expect(ui.tor).toBe(true)
    expect(ui.overlay).toBe(false) // no prompt is ever shown in Tor windows
  })

  test('"New Tor circuit" sends SIGNAL NEWNYM over the authenticated control port', async () => {
    await torGo(`http://${ONION}:${srv.port}/b`)
    const ok = await inMain<boolean>(h.app, 'return await s.tor.newCircuit()')
    expect(ok).toBe(true)
    expect(log()).toContain('NEWNYM')
  })

  test('normal windows are unaffected by Tor (direct, not proxied)', async () => {
    const before = log().split('\n').filter((l) => l.startsWith('SOCKS')).length
    const title = await inMain<string>(
      h.app,
      `const w = s.windows.create({ url: arg }); await new Promise((r) => setTimeout(r, 1500)); const t = w.activeTab.title; w.base.close(); return t`,
      `${srv.origin}/b`
    )
    expect(title).toBe('Page B')
    expect(log().split('\n').filter((l) => l.startsWith('SOCKS')).length).toBe(before)
    await sleep(300)
  })

  test('closing the last Tor window stops the Tor process', async () => {
    const pid = await inMain<number>(h.app, 'return s.tor.proc.pid')
    await inMain(h.app, `${torWin}.base.close()`)
    await sleep(1500)
    expect((await inMain<{ status: string }>(h.app, 'return s.tor.state()')).status).toBe('stopped')
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)
  })
})

test.describe('Tor window without a Tor binary', () => {
  test('shows an explanation and stays fail-closed', async () => {
    const h = await launch()
    try {
      await inMain(h.app, 'await s.windows.createTor()')
      await sleep(1500)
      const st = await inMain<{ status: string; error?: string }>(h.app, 'return s.tor.state()')
      expect(st.status).toBe('missing')
      expect(st.error).toContain('not found')
      const r = await inMain<{ title: string; blocked: string }>(
        h.app,
        `const w = s.windows.all().find((x) => x.tor); w.go('http://anything.onion/'); await new Promise((r) => setTimeout(r, 1200)); return { title: w.activeTab.title, blocked: w.activeTab.wc.getURL() }`
      )
      expect(r.title).toBe("Can't reach this page")
    } finally {
      await h.close()
    }
  })
})
