import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'
import { durationOf, startMediaServer } from './media-server'
import type { MediaServer } from './media-server'

let h: Harness
let media: MediaServer
let out: string

interface Job {
  id: string
  kind: string
  state: string
  progress: number
  file: string | null
  fileCount: number
  error?: string
  bytes: number
  stage: string
  title: string
}
const OPTS = { mode: 'video', height: null, container: 'mp4', audioFormat: 'mp3', subtitles: false, subLangs: [], thumbnail: false, playlist: false }

test.beforeAll(async () => {
  media = await startMediaServer()
  out = mkdtempSync(join(tmpdir(), 'bmax-dl-out-'))
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1' })
  await inMain(h.app, `s.settings.update({ downloads: { ...s.settings.get().downloads, folder: arg } })`, out)
})
test.afterAll(async () => {
  await h.close()
  await media.close()
  rmSync(out, { recursive: true, force: true })
})

const jobs = (): Promise<Job[]> => inMain(h.app, 'return s.downloads.list()')
async function waitJob(id: string, ok: (j: Job) => boolean, ms = 60_000): Promise<Job> {
  const end = Date.now() + ms
  for (;;) {
    const j = (await jobs()).find((x) => x.id === id)
    if (j && ok(j)) return j
    if (Date.now() > end) throw new Error(`job ${id} timed out: ${JSON.stringify(j)}`)
    await sleep(250)
  }
}
const finished = (j: Job): boolean => ['done', 'error', 'cancelled'].includes(j.state)
async function go(url: string): Promise<void> {
  await inMain(h.app, `s.windows.focused().go(arg)`, url)
  await sleep(300)
  for (let i = 0; i < 60; i++) {
    if (await inMain<boolean>(h.app, `const t = s.windows.focused().activeTab; return !t.loading && t.wc.getURL() !== ''`)) break
    await sleep(100)
  }
  await sleep(2500)
}
const files = (): string[] => readdirSync(out)
const startVideo = (url: string, opts: object = OPTS): Promise<string[]> =>
  inMain(h.app, `const tab = s.windows.focused().activeTab; return await s.downloads.startVideo(tab, arg.url, '', arg.opts, tab.url)`, { url, opts })

test('bundled yt-dlp and ffmpeg are installed and run', async () => {
  // Through the real IPC path from an internal page:
  await inMain(h.app, `s.windows.focused().execute('downloads')`)
  await sleep(1200)
  const viaPage = await inMain<{ ytdlp: { present: boolean; version: string }; ffmpeg: { present: boolean; version: string } }>(
    h.app,
    `return await s.windows.focused().activeTab.wc.executeJavaScript("window.bmax.cmd('downloads.tools')")`
  )
  expect(viaPage.ytdlp.present).toBe(true)
  expect(viaPage.ytdlp.version).toMatch(/^\d{4}\.\d{2}\.\d{2}/)
  expect(viaPage.ffmpeg.present).toBe(true)
  expect(viaPage.ffmpeg.version).toMatch(/^9\./)
})

test('detects video and images on a page and sniffs the media file from the network', async () => {
  await go(`${media.origin}/media-page`)
  const info = await inMain<{ media: { videos: number; images: number; sniffed: number } }>(h.app, 'return s.windows.focused().activeTab.info()')
  expect(info.media.videos).toBe(1)
  expect(info.media.images).toBe(2) // the 50x50 icon is below the 100px "real image" threshold
  expect(info.media.sniffed).toBeGreaterThanOrEqual(1)
  const sniffed = await inMain<{ url: string; kind: string; size: number | null }[]>(h.app, 'return s.media.sniffedList(s.windows.focused().activeTab.wc.id)')
  expect(sniffed.some((m) => m.url.endsWith('/clip.mp4') && m.kind === 'video')).toBe(true)
  const panel = await inMain<{ summary: { videos: number }; ytdlp: { present: boolean } }>(h.app, 'return await s.media.panelInfo(s.windows.focused().activeTab)')
  expect(panel.summary.videos).toBe(1)
  await go(`${media.origin}/plain-page`)
  expect((await inMain<{ media: { videos: number; sniffed: number } }>(h.app, 'return s.windows.focused().activeTab.info()')).media).toMatchObject({ videos: 0, sniffed: 0 })
})

test('sniffed direct file downloads through the browser engine into the chosen folder', async () => {
  await go(`${media.origin}/media-page`)
  const before = files().length
  await inMain(h.app, `s.windows.focused().activeTab.wc.downloadURL(arg)`, `${media.origin}/clip.mp4`)
  for (let i = 0; i < 80 && files().length === before; i++) await sleep(200)
  const list = await jobs()
  const j = list.find((x) => x.kind === 'file')!
  const done = await waitJob(j.id, finished)
  expect(done.state).toBe('done')
  expect(statSync(done.file!).size).toBe(media.clipBytes)
  expect(done.file!.startsWith(out)).toBe(true)
})

test('yt-dlp probes a media URL and downloads it as MP4 (and as MP3 audio)', async () => {
  test.setTimeout(240_000)
  await go(`${media.origin}/media-page`)
  const probe = await inMain<{ title: string; heights: number[]; hasAudio: boolean; extractor: string }>(
    h.app,
    `return await s.downloads.probe(s.windows.focused().activeTab, arg)`,
    `${media.origin}/clip.mp4`
  )
  expect(probe.title).toBe('clip')
  expect(probe.extractor.toLowerCase()).toContain('generic')
  expect(Array.isArray(probe.heights)).toBe(true) // direct files carry no per-format height; real sites do

  const [id] = await startVideo(`${media.origin}/clip.mp4`)
  const done = await waitJob(id!, finished)
  expect(done.error).toBeUndefined()
  expect(done.state).toBe('done')
  expect(done.file).toMatch(/\.mp4$/)
  expect(existsSync(done.file!)).toBe(true)
  expect(durationOf(done.file!)).toBeGreaterThan(2.5)

  const [aid] = await startVideo(`${media.origin}/clip.mp4`, { ...OPTS, mode: 'audio', audioFormat: 'mp3' })
  const adone = await waitJob(aid!, finished)
  expect(adone.error).toBeUndefined()
  expect(adone.file).toMatch(/\.mp3$/)
  expect(durationOf(adone.file!)).toBeGreaterThan(2.5)
  const [mid] = await startVideo(`${media.origin}/clip.mp4`, { ...OPTS, mode: 'audio', audioFormat: 'm4a' })
  expect((await waitJob(mid!, finished)).file).toMatch(/\.m4a$/)
})

test('HLS and DASH manifests found on the network are downloaded and merged with ffmpeg', async () => {
  test.setTimeout(240_000)
  await go(`${media.origin}/hls-page`)
  const hls = await inMain<{ url: string; kind: string }[]>(h.app, 'return s.media.sniffedList(s.windows.focused().activeTab.wc.id)')
  expect(hls.map((m) => m.kind)).toContain('hls')
  expect(hls.some((m) => m.url.endsWith('.ts'))).toBe(false) // segments are not listed
  const hlsUrl = hls.find((m) => m.kind === 'hls')!.url
  const [hid] = await inMain<string[]>(h.app, `const tab = s.windows.focused().activeTab; return await s.downloads.startStream(tab, arg, 'hls test', tab.url)`, hlsUrl)
  const hdone = await waitJob(hid!, finished, 90_000)
  expect(hdone.error).toBeUndefined()
  expect(durationOf(hdone.file!)).toBeGreaterThan(2.5)

  await go(`${media.origin}/dash-page`)
  const dash = await inMain<{ url: string; kind: string }[]>(h.app, 'return s.media.sniffedList(s.windows.focused().activeTab.wc.id)')
  expect(dash.map((m) => m.kind)).toContain('dash')
  const [did] = await inMain<string[]>(h.app, `const tab = s.windows.focused().activeTab; return await s.downloads.startStream(tab, arg, 'dash test', tab.url)`, dash.find((m) => m.kind === 'dash')!.url)
  const ddone = await waitJob(did!, finished, 90_000)
  expect(ddone.error).toBeUndefined()
  expect(durationOf(ddone.file!)).toBeGreaterThan(2.5)
})

test('"Save all images" honours the size filter', async () => {
  await go(`${media.origin}/media-page`)
  const summary = await inMain<{ total: number; byMinWidth: Record<string, number> }>(h.app, 'return await s.media.imageSummary(s.windows.focused().activeTab)')
  expect(summary.total).toBe(3)
  expect(summary.byMinWidth).toMatchObject({ '0': 3, '100': 2, '300': 2, '600': 1, '1000': 0 })
  const id = await inMain<string>(
    h.app,
    `const tab = s.windows.focused().activeTab; const all = await s.media.collectImages(tab); return await s.downloads.saveImages(tab, all.filter((i) => i.width >= 300))`
  )
  const done = await waitJob(id, finished)
  expect(done.state).toBe('done')
  expect(done.fileCount).toBe(2)
  const saved = readdirSync(done.file!)
  expect(saved.sort()).toEqual(['large.png', 'medium.png'])
})

test('pause, resume and cancel work for browser-engine downloads', async () => {
  await go(`${media.origin}/plain-page`)
  await inMain(h.app, `s.windows.focused().activeTab.wc.downloadURL(arg)`, `${media.origin}/slow/clip.mp4`)
  let job: Job | undefined
  for (let i = 0; i < 50 && !job; i++) {
    await sleep(200)
    job = (await jobs()).find((j) => j.kind === 'file' && j.state === 'downloading' && j.bytes > 0 && j.title.includes('clip'))
  }
  expect(job).toBeTruthy()
  await inMain(h.app, 's.downloads.action(arg, "pause")', job!.id)
  await sleep(700)
  const paused = (await jobs()).find((j) => j.id === job!.id)!
  expect(paused.state).toBe('paused')
  const frozen = paused.bytes
  await sleep(1000)
  expect((await jobs()).find((j) => j.id === job!.id)!.bytes).toBe(frozen)
  await inMain(h.app, 's.downloads.action(arg, "resume")', job!.id)
  const done = await waitJob(job!.id, finished, 90_000)
  expect(done.state).toBe('done')
  expect(statSync(done.file!).size).toBe(media.clipBytes)

  await inMain(h.app, `s.windows.focused().activeTab.wc.downloadURL(arg)`, `${media.origin}/slow/tone.mp3`)
  let j2: Job | undefined
  for (let i = 0; i < 50 && !j2; i++) {
    await sleep(200)
    j2 = (await jobs()).find((j) => j.kind === 'file' && j.state === 'downloading' && j.title.includes('tone'))
  }
  await inMain(h.app, 's.downloads.action(arg, "cancel")', j2!.id)
  expect((await waitJob(j2!.id, finished)).state).toBe('cancelled')
})

test('pause, resume, cancel and retry work for yt-dlp downloads (process tree is stopped)', async () => {
  test.setTimeout(300_000)
  await go(`${media.origin}/plain-page`)
  const [id] = await startVideo(`${media.origin}/slow/clip-a.mp4`)
  await waitJob(id!, (j) => j.state === 'downloading' && j.bytes > 0, 60_000)
  await inMain(h.app, 's.downloads.action(arg, "pause")', id)
  const paused = await waitJob(id!, (j) => j.state === 'paused', 15_000)
  expect(paused.state).toBe('paused')
  const alive = await inMain<boolean>(h.app, `return !!s.downloads.jobs.get(arg).proc`, id)
  expect(alive).toBe(false)
  await inMain(h.app, 's.downloads.action(arg, "resume")', id)
  const done = await waitJob(id!, finished, 120_000)
  expect(done.error).toBeUndefined()
  expect(done.state).toBe('done')
  expect(existsSync(done.file!)).toBe(true)

  const [id2] = await startVideo(`${media.origin}/slow/clip-b.mp4`, { ...OPTS, mode: 'audio' })
  await waitJob(id2!, (j) => j.state === 'downloading', 60_000)
  await inMain(h.app, 's.downloads.action(arg, "cancel")', id2)
  const cancelled = await waitJob(id2!, finished, 15_000)
  expect(cancelled.state).toBe('cancelled')
  await inMain(h.app, 's.downloads.action(arg, "retry")', id2)
  const retried = await waitJob(id2!, (j) => j.state === 'downloading' || j.state === 'done', 30_000)
  expect(['downloading', 'done']).toContain(retried.state)
  await inMain(h.app, 's.downloads.action(arg, "cancel")', id2)
  await waitJob(id2!, finished, 15_000)
})

test('playlists: a page with several videos is detected and all items are downloaded into one folder', async () => {
  test.setTimeout(240_000)
  await go(`${media.origin}/two-videos`)
  const probe = await inMain<{ isPlaylist: boolean; playlistCount: number; title: string }>(
    h.app,
    `return await s.downloads.probe(s.windows.focused().activeTab, arg)`,
    `${media.origin}/two-videos`
  )
  expect(probe.isPlaylist).toBe(true)
  expect(probe.playlistCount).toBe(2)
  const [id] = await startVideo(`${media.origin}/two-videos`, { ...OPTS, playlist: true })
  const done = await waitJob(id!, finished, 120_000)
  expect(done.error).toBeUndefined()
  expect(done.state).toBe('done')
  expect(done.fileCount).toBe(2)
})

test('invalid or unsafe requests are refused', async () => {
  await go(`${media.origin}/media-page`)
  const bad = await inMain<string>(
    h.app,
    `try { await s.downloads.probe(s.windows.focused().activeTab, 'file:///C:/Windows/win.ini'); return 'allowed' } catch (e) { return String(e.message) }`
  )
  expect(bad).toContain('web addresses')
  const bad2 = await inMain<string>(h.app, `try { await s.downloads.startVideo(s.windows.focused().activeTab, '--exec calc', '', arg, ''); return 'allowed' } catch (e) { return String(e.message) }`, OPTS)
  expect(bad2).toContain('web addresses')
  // an internal page may call the download commands, but a web page cannot (no bridge) and "sniffed" only accepts URLs seen on the page
  await inMain(h.app, `s.windows.focused().execute('downloads')`)
  await sleep(1000)
  const forbidden = await inMain<string>(
    h.app,
    `return await s.windows.focused().activeTab.wc.executeJavaScript("window.bmax.cmd('media.start', { kind: 'sniffed', url: 'http://evil.example/x.mp4' }).then(() => 'allowed', e => String(e.message))")`
  )
  expect(forbidden).toContain('Forbidden') // media.* is overlay-only
})
