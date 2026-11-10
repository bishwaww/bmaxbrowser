import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inMain, sleep } from './helpers'
import { startServer } from './server'

/**
 * Smoke test of the PACKAGED app (dist/win-unpacked, built by `npm run dist:dir`): asar layout, bundled resources,
 * the torrent utility process, the Shields worker, Readability, and the bundled binaries. Skipped when no package exists.
 */
const EXE = resolve(__dirname, '../../dist/win-unpacked/BMAX Browser.exe')
test.skip(!existsSync(EXE), 'run `npm run dist:dir` first')

test('the packaged app starts and its parts work from inside the package', async () => {
  test.setTimeout(120_000)
  const server = await startServer()
  const userData = mkdtempSync(join(tmpdir(), 'bmax-pkg-'))
  const app = await electron.launch({
    executablePath: EXE,
    args: [],
    env: { ...(process.env as Record<string, string>), BMAX_TEST: '1', BMAX_USER_DATA: userData, BMAX_SHIELDS_OFFLINE: '1' }
  })
  try {
    for (let i = 0; i < 100; i++) {
      const ready = await app
        .evaluate(() => (globalThis as unknown as { __bmax?: { metrics?: { firstWindowMs: number | null } } }).__bmax?.metrics?.firstWindowMs != null)
        .catch(() => false)
      if (ready) break
      await sleep(200)
    }
    const info = await inMain<{ packaged: boolean; version: string; firstWindowMs: number | null; resources: string }>(
      app,
      `return { packaged: s.updates.info().packaged, version: s.updates.info().version, firstWindowMs: s.metrics.firstWindowMs, resources: process.resourcesPath }`
    )
    console.log(`[packaged] first window at ${info.firstWindowMs} ms, version ${info.version}`)
    expect(info.packaged).toBe(true)
    expect(info.version).toBe('0.6.0')
    expect(info.firstWindowMs!).toBeLessThan(2000)

    // Bundled resources: binaries, icon, licences.
    for (const rel of ['resources/bin/tor/win32-x64/tor/tor.exe', 'resources/bin/yt-dlp/win32-x64/yt-dlp.exe', 'resources/bin/ffmpeg/win32-x64/ffmpeg.exe', 'resources/icons/icon.png', 'resources/licenses/THIRD_PARTY.md']) {
      expect(existsSync(join(info.resources, rel)), rel).toBe(true)
    }
    // Internal pages load from the package.
    await inMain(app, `s.windows.focused().go(arg)`, 'bmax://settings/?section=About')
    await sleep(1500)
    expect(await inMain<string>(app, `return s.windows.focused().activeTab.wc.getURL()`)).toContain('bmax://settings')

    // Reader mode (Readability bundled in the main process) on a real page.
    await inMain(app, `s.windows.focused().go(arg)`, `${server.origin}/article`)
    await sleep(1500)
    expect(await inMain<boolean>(app, `const a = await s.reader.extract(s.windows.focused().activeTab); return !!a && a.title === 'Test Article Title'`)).toBe(true)

    // Tor binary is found (the Tor window itself is covered by other tests).
    expect(await inMain<string>(app, `return s.tor.state().status`)).not.toBe('missing')

    // The torrent engine (utility process + dynamic ESM import of webtorrent inside the asar) starts.
    const running = await inMain<boolean>(app, `await s.torrents.ensure(); return s.torrents.status(s.windows.focused()).running`)
    expect(running).toBe(true)

    // yt-dlp and ffmpeg run from the package.
    const versions = await inMain<{ ytdlp: string; ffmpeg: string }>(
      app,
      `const cp = process.getBuiltinModule('node:child_process'); const path = process.getBuiltinModule('node:path')
       const r = process.resourcesPath
       const run = (rel, args) => cp.execFileSync(path.join(r, rel), args, { encoding: 'utf8', timeout: 60000 }).split('\\n')[0].trim()
       return { ytdlp: run('resources/bin/yt-dlp/win32-x64/yt-dlp.exe', ['--version']), ffmpeg: run('resources/bin/ffmpeg/win32-x64/ffmpeg.exe', ['-version']) }`
    )
    expect(versions.ytdlp).toMatch(/^\d{4}\.\d{2}\.\d{2}/)
    expect(versions.ffmpeg).toContain('ffmpeg version')

    // Shields worker (compiled filter engine) starts without network.
    const shields = await inMain<boolean>(app, `return typeof s.shields.panelInfo === 'function'`)
    expect(shields).toBe(true)
  } finally {
    await app.close().catch(() => undefined)
    await server.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
