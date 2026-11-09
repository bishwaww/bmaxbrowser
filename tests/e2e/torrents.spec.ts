import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { request } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'
import { startMediaServer } from './media-server'
import type { MediaServer } from './media-server'
import { sha256, startLeecher, startSeeder } from './swarm'
import type { Seeder } from './swarm'

let h: Harness
let media: MediaServer
let dest: string

interface T {
  id: string
  name: string
  state: string
  progress: number
  downloaded: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  ratio: number
  length: number
  savePath: string
  error?: string
  files: { index: number; path: string; name: string; length: number; downloaded: number; progress: number; selected: boolean }[]
}

test.beforeAll(async () => {
  media = await startMediaServer()
  dest = mkdtempSync(join(tmpdir(), 'bmax-tor-dest-'))
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1', BMAX_TOR_NOBIN: '1', BMAX_TORRENT_NO_UTP: '1' })
  await inMain(h.app, `s.settings.update({ torrents: { ...s.settings.get().torrents, folder: arg } })`, dest)
  // The IP-exposure warning is a native dialog: stub it ("I understand, continue") and count how often it is shown.
  await h.app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __dialogs: { message: string }[] }
    g.__dialogs = []
    dialog.showMessageBox = (async (_w: unknown, o?: { message?: string }) => {
      g.__dialogs.push({ message: String((o ?? (_w as { message?: string })).message) })
      return { response: 1, checkboxChecked: false }
    }) as unknown as typeof dialog.showMessageBox
  })
})
test.afterAll(async () => {
  await h.close()
  await media.close()
  rmSync(dest, { recursive: true, force: true })
})

const dialogs = (): Promise<{ message: string }[]> => h.app.evaluate(() => (globalThis as unknown as { __dialogs: { message: string }[] }).__dialogs)
const list = (): Promise<T[]> => inMain(h.app, 'return s.torrents.torrents()')
async function waitT(id: string, ok: (t: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const t = (await list()).find((x) => x.id === id)
    if (t && ok(t)) return t
    if (Date.now() > end) throw new Error(`torrent ${id} timed out: ${JSON.stringify(t)?.slice(0, 600)}`)
    await sleep(250)
  }
}
const addPeer = (id: string, port: number): Promise<void> => inMain(h.app, 'await s.torrents.testAddPeer(arg.id, arg.peer)', { id, peer: `127.0.0.1:${port}` })
const enginePort = (): Promise<number> => inMain(h.app, 'return s.torrents.status(null).port')
async function reset(): Promise<void> {
  await inMain(h.app, 's.torrents.reset()')
  await sleep(500)
}

const PACK = (): { path: string; size: number; from?: string }[] => [
  { path: 'a.txt', size: 200_000 },
  { path: 'b.bin', size: 300_000 },
  { path: 'video/clip.mp4', size: 0, from: join(media.dir, 'clip.mp4') },
  { path: 'docs/notes.txt', size: 50_000 }
]

test.describe.serial('torrent engine (local swarm, no internet)', () => {
  let seeder: Seeder

  test('adds a .torrent file: shows the warning once, lets you choose files, downloads only those', async () => {
    seeder = await startSeeder('pack1', PACK())
    const added = await inMain<{ id: string } | null>(h.app, 'return await s.torrents.addTorrentData(arg, s.windows.focused())', [...seeder.torrentFile])
    expect(added!.id).toBe(seeder.infoHash)
    expect((await dialogs()).filter((d) => d.message.includes('NOT routed through Tor'))).toHaveLength(1)

    const t = await waitT(seeder.infoHash, (x) => x.state === 'selecting')
    expect(t.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.bin', 'docs/notes.txt', 'video/clip.mp4'].map((p) => `pack1/${p}`).sort())
    expect(t.progress).toBe(0) // nothing is downloaded before the user chooses
    await addPeer(seeder.infoHash, seeder.port)
    await sleep(1500)
    expect((await waitT(seeder.infoHash, () => true)).downloaded).toBe(0)

    const wanted = t.files.filter((f) => f.path.endsWith('a.txt') || f.path.endsWith('clip.mp4')).map((f) => f.index)
    await inMain(h.app, 'await s.torrents.start(arg.id, arg.files)', { id: seeder.infoHash, files: wanted })
    const done = await waitT(seeder.infoHash, (x) => x.state === 'seeding' && x.files.filter((f) => f.selected).every((f) => f.progress >= 0.999))
    expect(done.state).toBe('seeding')
    for (const f of seeder.files.filter((x) => x.path === 'a.txt' || x.path.endsWith('clip.mp4'))) {
      expect(sha256(join(dest, 'pack1', ...f.path.split('/'))), f.path).toBe(f.sha256)
    }
    // the unchosen files were not downloaded
    const b = join(dest, 'pack1', 'b.bin')
    expect(!existsSync(b) || statSync(b).size === 0 || sha256(b) !== seeder.files.find((f) => f.path === 'b.bin')!.sha256).toBe(true)
    expect(done.files.find((f) => f.path.endsWith('docs/notes.txt'))!.progress).toBeLessThan(0.999)
  })

  test('selection can be changed while the torrent is active', async () => {
    const t = (await list())[0]!
    const b = t.files.find((f) => f.path.endsWith('b.bin'))!
    const notes = t.files.find((f) => f.path.endsWith('notes.txt'))!
    await inMain(h.app, 'await s.torrents.setFiles(arg.id, arg.files)', { id: t.id, files: t.files.map((f) => f.index) })
    const done = await waitT(t.id, (x) => x.files.every((f) => f.progress >= 0.999), 60_000)
    expect(done.state).toBe('seeding')
    expect(sha256(join(dest, 'pack1', 'b.bin'))).toBe(seeder.files.find((f) => f.path === 'b.bin')!.sha256)
    expect(sha256(join(dest, 'pack1', 'docs', 'notes.txt'))).toBe(seeder.files.find((f) => f.path === 'docs/notes.txt')!.sha256)
    void b
    void notes
  })

  test('seeding: another client downloads from BMAX, uploads are counted, ratio is shown', async () => {
    const t = (await list())[0]!
    const port = await enginePort()
    expect(port).toBeGreaterThan(0)
    await seeder.close() // the original seeder goes away: BMAX is now the only source
    const leech = await startLeecher(seeder.magnet, `127.0.0.1:${port}`)
    try {
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error('leecher never finished')), 60_000)
        leech.torrent.on('done', () => {
          clearTimeout(timer)
          res()
        })
      })
      for (const f of seeder.files) expect(sha256(join(leech.dir, 'pack1', ...f.path.split('/'))), f.path).toBe(f.sha256)
    } finally {
      await leech.close()
    }
    const after = await waitT(t.id, (x) => x.uploaded > 400_000)
    expect(after.uploaded).toBeGreaterThan(400_000)
    expect(after.ratio).toBeGreaterThan(0.5)
    expect(after.state).toBe('seeding')
  })

  test('remove keeps the files; "remove and delete files" removes them', async () => {
    const t = (await list())[0]!
    await inMain(h.app, 'await s.torrents.action(arg, "remove")', t.id)
    await sleep(600)
    expect((await list()).length).toBe(0)
    expect(existsSync(join(dest, 'pack1', 'a.txt'))).toBe(true)
    // add again from a fresh seeder with the same content, finish, then delete with files
    const s2 = await startSeeder('pack2', PACK())
    try {
      await inMain(h.app, 'return await s.torrents.addTorrentData(arg, s.windows.focused())', [...s2.torrentFile])
      await addPeer(s2.infoHash, s2.port)
      const sel = await waitT(s2.infoHash, (x) => x.state === 'selecting')
      await inMain(h.app, 'await s.torrents.start(arg.id, arg.files)', { id: s2.infoHash, files: sel.files.map((f) => f.index) })
      await waitT(s2.infoHash, (x) => x.state === 'seeding')
      expect(existsSync(join(dest, 'pack2', 'a.txt'))).toBe(true)
      await inMain(h.app, 'await s.torrents.action(arg, "removeFiles")', s2.infoHash)
      await sleep(800)
      expect(existsSync(join(dest, 'pack2'))).toBe(false)
      expect(existsSync(join(dest, 'pack1', 'a.txt'))).toBe(true) // other torrents untouched
    } finally {
      await s2.close()
    }
  })
})

test.describe.serial('magnet links, limits, pause, seeding rule', () => {
  test('a magnet link resolves its metadata from a peer; no second warning', async () => {
    await reset()
    const s = await startSeeder('mag1', [{ path: 'one.bin', size: 150_000 }, { path: 'two.bin', size: 150_000 }])
    try {
      const before = (await dialogs()).length
      const added = await inMain<{ id: string } | null>(h.app, 'return await s.torrents.addMagnet(arg, s.windows.focused())', s.magnet)
      expect(added).not.toBeNull() // reset() forgot the acknowledgement, so the warning is shown again (the stub says "continue")
      expect((await dialogs()).length).toBe(before + 1)
      const again = await inMain<{ id: string } | null>(h.app, 'return await s.torrents.addMagnet(arg, s.windows.focused())', s.magnet)
      expect(again).not.toBeNull()
      expect((await dialogs()).length).toBe(before + 1) // acknowledged for this session
      expect((await waitT(s.infoHash, () => true)).state).toBe('metadata')
      await addPeer(s.infoHash, s.port)
      const sel = await waitT(s.infoHash, (x) => x.state === 'selecting')
      expect(sel.files).toHaveLength(2)
      await inMain(h.app, 'await s.torrents.start(arg.id, arg.files)', { id: s.infoHash, files: sel.files.map((f) => f.index) })
      await waitT(s.infoHash, (x) => x.state === 'seeding')
      for (const f of s.files) expect(sha256(join(dest, 'mag1', f.path))).toBe(f.sha256)
    } finally {
      await s.close()
    }
  })

  test('invalid magnet links are refused before anything starts', async () => {
    const r = await inMain<string>(h.app, `try { await s.torrents.addMagnet('magnet:?xt=urn:btih:nothex', s.windows.focused()); return 'allowed' } catch (e) { return String(e.message) }`)
    expect(r).toContain('not a valid magnet')
  })

  test('download speed limit is enforced; pause stops traffic; resume continues', async () => {
    await inMain(h.app, `s.settings.update({ torrents: { ...s.settings.get().torrents, downKBps: 150, askFiles: false } })`)
    const s = await startSeeder('limit1', [{ path: 'big.bin', size: 2_500_000 }])
    try {
      await inMain(h.app, 'return await s.torrents.addTorrentData(arg, s.windows.focused())', [...s.torrentFile])
      await addPeer(s.infoHash, s.port)
      await waitT(s.infoHash, (x) => x.state === 'downloading' && x.downloaded > 0, 30_000)
      const t0 = await waitT(s.infoHash, () => true)
      const start = Date.now()
      await sleep(4000)
      const t1 = await waitT(s.infoHash, () => true)
      const rate = (t1.downloaded - t0.downloaded) / ((Date.now() - start) / 1000)
      console.log('measured rate KiB/s', Math.round(rate / 1024))
      expect(rate).toBeLessThan(150 * 1024 * 1.6) // limited (with slack for bursts)
      expect(rate).toBeGreaterThan(20 * 1024) // but it is actually moving

      await inMain(h.app, 'await s.torrents.action(arg, "pause")', s.infoHash)
      await sleep(1500)
      const p1 = await waitT(s.infoHash, (x) => x.state === 'paused')
      expect(p1.numPeers).toBe(0)
      expect(p1.downloadSpeed).toBe(0)
      await sleep(2500)
      const p2 = await waitT(s.infoHash, () => true)
      expect(p2.downloaded).toBe(p1.downloaded) // nothing more arrives while paused

      await inMain(h.app, `s.settings.update({ torrents: { ...s.settings.get().torrents, downKBps: 0 } })`)
      await inMain(h.app, 'await s.torrents.action(arg, "resume")', s.infoHash)
      await addPeer(s.infoHash, s.port)
      const done = await waitT(s.infoHash, (x) => x.state === 'seeding', 90_000)
      expect(sha256(join(dest, 'limit1', 'big.bin'))).toBe(s.files[0]!.sha256)
      expect(done.downloaded).toBeGreaterThanOrEqual(2_500_000)
    } finally {
      await s.close()
    }
  })

  test('"stop seeding when finished" stops sharing and keeps the finished entry', async () => {
    await inMain(h.app, `s.settings.update({ torrents: { ...s.settings.get().torrents, stopSeedingWhenDone: true, downKBps: 0, askFiles: false } })`)
    const s = await startSeeder('stop1', [{ path: 'x.bin', size: 200_000 }])
    try {
      await inMain(h.app, 'return await s.torrents.addTorrentData(arg, s.windows.focused())', [...s.torrentFile])
      await addPeer(s.infoHash, s.port)
      const t = await waitT(s.infoHash, (x) => x.state === 'finished', 60_000)
      expect(t.numPeers).toBe(0)
      expect(t.uploadSpeed).toBe(0)
      expect(sha256(join(dest, 'stop1', 'x.bin'))).toBe(s.files[0]!.sha256)
      // nobody can fetch from BMAX any more
      const port = await enginePort()
      const leech = await startLeecher(s.magnet, `127.0.0.1:${port}`)
      try {
        await s.close()
        await sleep(4000)
        expect(leech.torrent.progress).toBe(0)
      } finally {
        await leech.close()
      }
    } finally {
      await inMain(h.app, `s.settings.update({ torrents: { ...s.settings.get().torrents, stopSeedingWhenDone: false } })`)
    }
  })
})

test.describe.serial('streaming', () => {
  const clip = (): string => join(media.dir, 'clip.mp4')
  test('the loopback server streams a file while the torrent downloads: ranges, token and host checks', async () => {
    await reset()
    await inMain(h.app, `s.settings.update({ torrents: { ...s.settings.get().torrents, askFiles: true, downKBps: 0 } })`)
    const s = await startSeeder('stream1', [{ path: 'a.bin', size: 100_000 }, { path: 'clip.mp4', size: 0, from: clip() }])
    try {
      await inMain(h.app, 'return await s.torrents.addTorrentData(arg, s.windows.focused())', [...s.torrentFile])
      await addPeer(s.infoHash, s.port)
      const sel = await waitT(s.infoHash, (x) => x.state === 'selecting')
      const idx = sel.files.find((f) => f.path.endsWith('clip.mp4'))!.index
      // nothing chosen yet, but streaming still works (pieces are fetched on demand)
      const st = await inMain<{ url: string; mime: string }>(h.app, 'return await s.torrents.stream(arg.id, arg.file)', { id: s.infoHash, file: idx })
      expect(st.mime).toBe('video/mp4')
      expect(st.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]+\//)
      const original = readFileSync(clip())

      const get = (url: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }> =>
        new Promise((res, rej) => {
          const u = new URL(url)
          const req = request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, (r) => {
            const chunks: Buffer[] = []
            r.on('data', (c: Buffer) => chunks.push(c))
            r.on('end', () => res({ status: r.statusCode ?? 0, body: Buffer.concat(chunks), headers: r.headers }))
          })
          req.on('error', rej)
          req.end()
        })

      const range = await get(st.url, { range: 'bytes=0-1023' })
      expect(range.status).toBe(206)
      expect(range.headers['content-range']).toBe(`bytes 0-1023/${original.length}`)
      expect(range.body.equals(original.subarray(0, 1024))).toBe(true)
      const tail = await get(st.url, { range: 'bytes=-500' })
      expect(tail.status).toBe(206)
      expect(tail.body.equals(original.subarray(original.length - 500))).toBe(true)
      const full = await get(st.url)
      expect(full.status).toBe(200)
      expect(full.body.equals(original)).toBe(true)
      expect((await get(st.url, {}, 'HEAD')).status).toBe(200)
      expect((await get(st.url, { range: 'bytes=999999999-' })).status).toBe(416)
      // security: wrong token, no token, foreign Host header, wrong method
      expect((await get(st.url.replace(/\/s\/[0-9a-f]+\//, '/s/deadbeef/'))).status).toBe(403)
      expect((await get(st.url.replace(/\/s\/[0-9a-f]+\//, '/'))).status).toBe(403)
      expect((await get(st.url, { host: 'evil.example' })).status).toBe(403)
      expect((await get(st.url, {}, 'POST')).status).toBe(405)
      expect((await get(st.url.replace(`/${idx}/`, '/99/'))).status).toBe(404)
    } finally {
      await s.close()
    }
  })

  test('the Torrents page: warning, file picker, and the built-in player plays the streamed video', async () => {
    test.setTimeout(120_000)
    await reset()
    const s = await startSeeder('ui1', [{ path: 'notes.txt', size: 20_000 }, { path: 'clip.mp4', size: 0, from: clip() }])
    try {
      await inMain(h.app, 's.windows.focused().openTab("bmax://torrents")')
      await sleep(1500)
      const page: Page = h.app.windows().find((p) => p.url().startsWith('bmax://torrents'))!
      await expect(page.getByRole('alert')).toContainText('NOT routed through Tor')
      await expect(page.getByText('No torrents.')).toBeVisible()

      await inMain(h.app, 'return await s.torrents.addTorrentData(arg, s.windows.focused())', [...s.torrentFile])
      await addPeer(s.infoHash, s.port)
      await expect(page.getByText('Choose which files to download')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByLabel('Download ui1/notes.txt')).toBeChecked()
      await page.getByLabel('Download ui1/notes.txt').uncheck()
      await expect(page.getByText('1 of 2 files')).toBeVisible()

      await page.getByRole('button', { name: 'Play' }).click()
      const video = page.locator('video')
      await expect(video).toBeVisible({ timeout: 15_000 })
      await expect.poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
      expect(await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, Math.round(v.duration)])).toEqual([640, 3])

      await page.getByRole('button', { name: 'Start download' }).click()
      await expect(page.getByText('Seeding').first()).toBeVisible({ timeout: 30_000 })
      expect(existsSync(join(dest, 'ui1', 'clip.mp4'))).toBe(true)
      const notes = join(dest, 'ui1', 'notes.txt')
      expect(!existsSync(notes) || statSync(notes).size === 0 || sha256(notes) !== s.files.find((f) => f.path === 'notes.txt')!.sha256).toBe(true) // unchosen file was not downloaded
    } finally {
      await s.close()
    }
  })
})

test.describe('browser integration', () => {
  test('clicking a magnet link opens the torrent manager (needs a user gesture); scripted ones are ignored', async () => {
    await reset()
    const s = await startSeeder('link1', [{ path: 'f.bin', size: 60_000 }])
    try {
      const magnetUrl = s.magnet
      await inMain(h.app, `s.windows.focused().go(arg)`, `${media.origin}/plain-page`)
      await sleep(1500)
      await inMain(h.app, `await s.windows.focused().activeTab.wc.executeJavaScript('document.body.innerHTML = ' + JSON.stringify('<a id=m href="' + arg + '">torrent</a>') + '; 1')`, magnetUrl)
      const tabsBefore = await inMain<number>(h.app, 'return s.windows.focused().tabs.length')
      // no gesture → ignored
      await inMain(h.app, `s.windows.focused().activeTab.lastGestureAt = 0; s.windows.focused().activeTab.wc.executeJavaScript("document.getElementById('m').click()", true)`)
      await sleep(1500)
      expect(await inMain<number>(h.app, 'return s.torrents.torrents().length')).toBe(0)
      expect(await inMain<number>(h.app, 'return s.windows.focused().tabs.length')).toBe(tabsBefore)
      // with a user gesture → added and the manager opens
      await inMain(h.app, `s.windows.focused().activeTab.lastGestureAt = Date.now(); s.windows.focused().activeTab.wc.executeJavaScript("document.getElementById('m').click()", true)`)
      for (let i = 0; i < 40 && (await inMain<number>(h.app, 'return s.torrents.torrents().length')) === 0; i++) await sleep(250)
      expect(await inMain<number>(h.app, 'return s.torrents.torrents().length')).toBe(1)
      await sleep(800)
      expect(await inMain<string>(h.app, 'return s.windows.focused().activeTab.url')).toBe('bmax://torrents/')
      expect(await inMain<string>(h.app, `return s.windows.focused().tabs.find((t) => t.url.includes('plain-page')).url`)).toContain('plain-page') // the original tab did not navigate
    } finally {
      await s.close()
    }
  })

  test('.torrent files served by a website open in the torrent manager instead of being saved', async () => {
    await reset()
    const s = await startSeeder('dl1', [{ path: 'f.bin', size: 60_000 }])
    const { createServer } = await import('node:http')
    const srv = createServer((req, res) => {
      if (req.url === '/x.torrent') {
        res.writeHead(200, { 'content-type': 'application/x-bittorrent', 'content-disposition': 'attachment; filename="x.torrent"' })
        res.end(s.torrentFile)
      } else res.writeHead(404).end()
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as { port: number }).port
    try {
      await inMain(h.app, `s.windows.focused().go(arg)`, `${media.origin}/plain-page`)
      await sleep(1000)
      const jobsBefore = await inMain<number>(h.app, 'return s.downloads.list().length')
      await inMain(h.app, `s.windows.focused().activeTab.wc.downloadURL(arg)`, `http://127.0.0.1:${port}/x.torrent`)
      for (let i = 0; i < 40 && (await inMain<number>(h.app, 'return s.torrents.torrents().length')) === 0; i++) await sleep(250)
      expect((await list())[0]!.id).toBe(s.infoHash)
      expect(await inMain<number>(h.app, 'return s.downloads.list().length')).toBe(jobsBefore) // not a normal download
    } finally {
      srv.close()
      await s.close()
    }
  })

  test('Burn stops the engine and forgets the torrents; the files stay on disk', async () => {
    await inMain(h.app, 'await s.windows.burn()')
    await sleep(1200)
    expect(await inMain<boolean>(h.app, 'return s.torrents.isRunning()')).toBe(false)
    expect((await list()).length).toBe(0)
    expect(existsSync(join(dest, 'pack1', 'a.txt'))).toBe(true)
  })
})

test.describe('Tor windows have no torrents at all', () => {
  test('the page, the commands, magnet links and .torrent downloads are all refused', async () => {
    await reset()
    await inMain(h.app, 'await s.windows.createTor()')
    await sleep(800)
    const torWin = 's.windows.all().find((w) => w.tor)'
    // the torrent page explains why it is empty
    await inMain(h.app, `${torWin}.openTab('bmax://torrents')`)
    await sleep(1500)
    const text = await inMain<string>(h.app, `return await ${torWin}.activeTab.wc.executeJavaScript('document.body.innerText')`)
    expect(text).toContain('Torrents are disabled in Tor windows')
    expect(text).not.toContain('Paste a magnet link')
    // every command is rejected from the Tor window's page
    for (const cmd of [`'torrents.addMagnet', { uri: 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a' }`, `'torrents.stream', { id: 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a', file: 0 }`, `'torrents.clear'`]) {
      const r = await inMain<string>(h.app, `return await ${torWin}.activeTab.wc.executeJavaScript("window.bmax.cmd(${cmd.replace(/"/g, '\\"')}).then(() => 'allowed', e => String(e.message))")`)
      expect(r, cmd).toContain('disabled in Tor windows')
    }
    // a magnet link clicked in a Tor window never starts the engine
    const before = (await dialogs()).length
    await inMain(h.app, `const t = ${torWin}.activeTab; t.lastGestureAt = Date.now(); await s.torrents.handleMagnet('magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a', t)`)
    expect(await inMain<boolean>(h.app, 'return s.torrents.isRunning()')).toBe(false)
    const msgs = (await dialogs()).slice(before)
    expect(msgs.some((d) => d.message.includes('disabled in Tor windows'))).toBe(true)
    expect(msgs.some((d) => d.message.includes('NOT routed through Tor'))).toBe(false)
    await inMain(h.app, `${torWin}.base.close()`)
    await sleep(500)
  })
})
