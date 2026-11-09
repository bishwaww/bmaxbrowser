import { expect, test } from '@playwright/test'
import { inMain, launch, sleep } from './helpers'

/**
 * Opt-in smoke test against the REAL bundled Tor binary and the real Tor network.
 * Needs internet access and resources/bin/tor installed (docs/BINARIES.md). Run with: BMAX_REAL_TOR=1 npx playwright test tor-real
 */
test.skip(process.env['BMAX_REAL_TOR'] !== '1', 'set BMAX_REAL_TOR=1 to run against the real Tor network')
test.setTimeout(240_000)

test('real Tor: bootstraps, routes a Tor window, and the Tor Project confirms it', async () => {
  const h = await launch()
  try {
    await inMain(h.app, 'await s.windows.createTor()')
    let state = { status: 'starting', progress: 0, summary: '', error: '' as string | undefined }
    for (let i = 0; i < 180; i++) {
      state = await inMain(h.app, 'return s.tor.state()')
      if (state.status === 'ready' || state.status === 'failed' || state.status === 'missing') break
      await sleep(1000)
    }
    expect(state.status, JSON.stringify(state)).toBe('ready')

    const torWin = 's.windows.all().find((w) => w.tor)'
    await inMain(h.app, `${torWin}.go('https://check.torproject.org/api/ip')`)
    let body = ''
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      body = await inMain<string>(h.app, `const wc = ${torWin}.activeTab.wc; return wc.isLoading() ? '' : await wc.executeJavaScript('document.body ? document.body.innerText : ""')`)
      if (body.includes('IsTor')) break
    }
    expect(body).toContain('"IsTor":true')

    // A fresh circuit still works and still exits through Tor.
    expect(await inMain<boolean>(h.app, 'return await s.tor.newCircuit()')).toBe(true)
  } finally {
    await h.close()
  }
})
