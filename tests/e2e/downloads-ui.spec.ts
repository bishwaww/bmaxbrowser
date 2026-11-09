import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, screenshot, sleep } from './helpers'
import { durationOf, startMediaServer } from './media-server'
import type { MediaServer } from './media-server'

let h: Harness
let media: MediaServer
let out: string

test.beforeAll(async () => {
  media = await startMediaServer()
  out = mkdtempSync(join(tmpdir(), 'bmax-dlui-'))
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1' })
  await inMain(h.app, `s.settings.update({ downloads: { ...s.settings.get().downloads, folder: arg } })`, out)
})
test.afterAll(async () => {
  await h.close()
  await media.close()
  rmSync(out, { recursive: true, force: true })
})

const chromePage = (): Page => h.app.windows().find((p) => p.url().startsWith('bmax://chrome'))!
const overlay = (kind: string): Page | undefined => h.app.windows().find((p) => p.url().includes('overlay') && p.url().includes(`kind=${kind}`))
async function go(url: string): Promise<void> {
  await inMain(h.app, `s.windows.focused().go(arg)`, url)
  await sleep(300)
  for (let i = 0; i < 60; i++) {
    if (await inMain<boolean>(h.app, `const t = s.windows.focused().activeTab; return !t.loading && t.wc.getURL() !== ''`)) break
    await sleep(100)
  }
  await sleep(2500)
}
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms
  let v = await fn()
  while (!ok(v) && Date.now() < end) {
    await sleep(250)
    v = await fn()
  }
  return v
}
interface Job {
  id: string
  state: string
  file: string | null
  fileCount: number
  kind: string
}
const jobs = (): Promise<Job[]> => inMain(h.app, 'return s.downloads.list()')

test('the address-bar download button appears only on pages with media', async () => {
  await go(`${media.origin}/plain-page`)
  await expect(chromePage().getByLabel('Download media from this page')).toHaveCount(0)
  await go(`${media.origin}/media-page`)
  await expect(chromePage().getByLabel('Download media from this page')).toBeVisible({ timeout: 8000 })
})

test('media panel: analyse, choose options and start a video download', async () => {
  test.setTimeout(180_000)
  await go(`${media.origin}/media-page`)
  await chromePage().getByLabel('Download media from this page').click()
  const panel = await waitFor(async () => overlay('media'), (p) => !!p)
  expect(panel).toBeTruthy()
  await expect(panel!.getByRole('dialog', { name: 'Download media' })).toBeVisible()
  // yt-dlp analyses the page's video automatically
  await expect(panel!.getByText('Media Page (1)', { exact: true })).toBeVisible({ timeout: 60_000 }) // yt-dlp's HTML5 embed extractor found the page's <video>
  await expect(panel!.getByLabel('Quality')).toBeVisible()
  await expect(panel!.getByLabel('Format')).toHaveValue('mp4')
  await panel!.getByLabel('Format').selectOption('webm')
  await panel!.getByLabel('Format').selectOption('mp4')
  await screenshot(h.app, 'overlay:media', 'media-panel.png')
  // the network-sniffed file is listed too
  await expect(panel!.getByText('Found on this page')).toBeVisible()
  await expect(panel!.getByText('Video file').first()).toBeVisible()

  await panel!.getByRole('button', { name: 'Download', exact: true }).first().click()
  await expect(panel!.getByText('Added to Downloads')).toBeVisible({ timeout: 10_000 })
  const done = await waitFor(async () => (await jobs()).find((j) => j.kind === 'video'), (j) => !!j && ['done', 'error'].includes(j.state), 120_000)
  expect(done!.state).toBe('done')
  expect(done!.file).toMatch(/\.mp4$/)
  expect(durationOf(done!.file!)).toBeGreaterThan(2.5)
})

test('media panel: audio-only choice produces an MP3', async () => {
  test.setTimeout(180_000)
  await go(`${media.origin}/media-page`)
  await chromePage().getByLabel('Download media from this page').click()
  const panel = await waitFor(async () => overlay('media'), (p) => !!p)
  await expect(panel!.getByLabel('Quality')).toBeVisible({ timeout: 60_000 })
  await panel!.getByLabel('Audio only').check()
  await panel!.getByLabel('Audio format').selectOption('mp3')
  await panel!.getByRole('button', { name: 'Download', exact: true }).first().click()
  await expect(panel!.getByText('Added to Downloads')).toBeVisible({ timeout: 10_000 })
  const done = await waitFor(async () => (await jobs()).find((j) => j.kind === 'audio'), (j) => !!j && ['done', 'error'].includes(j.state), 120_000)
  expect(done!.state).toBe('done')
  expect(done!.file).toMatch(/\.mp3$/)
})

test('media panel: images tab saves only images over the chosen width', async () => {
  await go(`${media.origin}/media-page`)
  await chromePage().getByLabel('Download media from this page').click()
  const panel = await waitFor(async () => overlay('media'), (p) => !!p)
  await panel!.getByRole('tab', { name: /Images/ }).click()
  await panel!.getByLabel('Minimum image width').selectOption('600')
  await expect(panel!.getByRole('button', { name: 'Save 1 images' })).toBeVisible()
  await panel!.getByLabel('Minimum image width').selectOption('300')
  await panel!.getByRole('button', { name: 'Save 2 images' }).click()
  await expect(panel!.getByText('Saving images')).toBeVisible()
  const done = await waitFor(async () => (await jobs()).find((j) => j.kind === 'images'), (j) => !!j && ['done', 'error'].includes(j.state))
  expect(done!.state).toBe('done')
  expect(readdirSync(done!.file!).sort()).toEqual(['large.png', 'medium.png'])
})

test('downloads page (Ctrl+J): live list with pause, resume, cancel and clear', async () => {
  test.setTimeout(180_000)
  await go(`${media.origin}/plain-page`)
  await inMain(h.app, `const wc = s.windows.focused().chromeView.webContents; wc.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['control'] })`)
  await sleep(1200)
  expect(await inMain<string>(h.app, 'return s.windows.focused().activeTab.url')).toBe('bmax://downloads/')
  const page = h.app.windows().find((p) => p.url().startsWith('bmax://downloads'))!
  await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible()
  // finished jobs from the previous tests are listed with Open / Show-in-folder actions
  await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible()
  await screenshot(h.app, 'tab', 'downloads-page.png')

  // a slow browser-engine download can be paused, resumed and finished from the page
  await inMain(h.app, `const w = s.windows.focused(); w.openTab(arg); w.execute('downloads')`, `${media.origin}/plain-page`)
  await sleep(1500)
  await inMain(h.app, `const w = s.windows.focused(); w.tabs.find((t) => t.url.includes('plain-page')).wc.downloadURL(arg)`, `${media.origin}/slow/tone.mp3`)
  const dl = h.app.windows().find((p) => p.url().startsWith('bmax://downloads'))!
  await expect(dl.getByRole('progressbar').first()).toBeVisible({ timeout: 15_000 })
  await dl.getByRole('button', { name: 'Pause' }).first().click()
  await expect(dl.getByRole('button', { name: 'Resume' }).first()).toBeVisible({ timeout: 10_000 })
  await dl.getByRole('button', { name: 'Resume' }).first().click()
  await expect(dl.getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 10_000 })
  await dl.getByRole('button', { name: 'Cancel' }).first().click()
  await expect(dl.getByText('Cancelled').first()).toBeVisible({ timeout: 10_000 })
  await dl.getByRole('button', { name: 'Clear finished' }).click()
  await expect(dl.getByText('Nothing downloaded yet')).toBeVisible({ timeout: 10_000 })
  expect((await jobs()).length).toBe(0)
})

test('Burn stops downloads and forgets the list (files stay on disk)', async () => {
  await go(`${media.origin}/plain-page`)
  await inMain(h.app, `s.windows.focused().activeTab.wc.downloadURL(arg)`, `${media.origin}/slow/clip-b.mp4`)
  await sleep(1500)
  expect((await jobs()).length).toBeGreaterThan(0)
  const filesBefore = readdirSync(out).length
  await inMain(h.app, 'await s.windows.burn()')
  await sleep(1500)
  expect((await jobs()).length).toBe(0)
  expect(readdirSync(out).length).toBeGreaterThanOrEqual(filesBefore - 1) // earlier finished files are untouched
  expect(existsSync(out)).toBe(true)
})

test.describe('downloads in a Tor window', () => {
  test('are refused until Tor is connected, then go through the SOCKS proxy with remote DNS', async () => {
    test.setTimeout(240_000)
    const logDir = mkdtempSync(join(tmpdir(), 'bmax-dl-tor-'))
    const logFile = join(logDir, 'tor.log')
    const t = await launch({ BMAX_TOR_FAKE: resolve(__dirname, 'fake-tor.cjs'), FAKE_TOR_TARGET: String(media.port), FAKE_TOR_LOG: logFile, FAKE_TOR_STEP_MS: '1200', BMAX_SHIELDS_OFFLINE: '1' })
    const tout = mkdtempSync(join(tmpdir(), 'bmax-dl-tor-out-'))
    try {
      await inMain(t.app, `s.settings.update({ downloads: { ...s.settings.get().downloads, folder: arg } })`, tout)
      await inMain(t.app, 'await s.windows.createTor()')
      await sleep(600)
      const early = await inMain<string>(
        t.app,
        `const tab = s.windows.all().find((w) => w.tor).activeTab; try { await s.downloads.startStream(tab, 'http://bmaxdltest.onion:${media.port}/hls/index.m3u8', 'x', tab.url); return 'allowed' } catch (e) { return String(e.message) }`
      )
      expect(early).toContain('Tor is not connected')
      for (let i = 0; i < 100 && !(await inMain<boolean>(t.app, 'return s.tor.isReady()')); i++) await sleep(200)
      const id = await inMain<string>(
        t.app,
        `const w = s.windows.all().find((x) => x.tor); const tab = w.activeTab; const ids = await s.downloads.startStream(tab, 'http://bmaxdltest.onion:${media.port}/hls/index.m3u8', 'tor hls', 'http://bmaxdltest.onion/'); return ids[0]`
      )
      let job: Job | undefined
      for (let i = 0; i < 240; i++) {
        job = (await inMain<Job[]>(t.app, 'return s.downloads.list()')).find((j) => j.id === id)
        if (job && ['done', 'error'].includes(job.state)) break
        await sleep(500)
      }
      expect(job!.state, JSON.stringify(job)).toBe('done')
      expect(durationOf(job!.file!)).toBeGreaterThan(2.5)
      const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
      expect(log).toContain('SOCKS DOMAIN bmaxdltest.onion')
      expect(log).not.toMatch(/SOCKS IP/)
      expect((await inMain<{ viaTor: boolean }[]>(t.app, 'return s.downloads.list()'))[0]!.viaTor).toBe(true)
    } finally {
      await t.close()
      rmSync(logDir, { recursive: true, force: true })
      rmSync(tout, { recursive: true, force: true })
    }
  })
})
