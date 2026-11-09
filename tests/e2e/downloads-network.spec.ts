import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'
import { durationOf, FFPROBE } from './media-server'

/**
 * Opt-in tests against real YouTube (public, no sign-in):  BMAX_NETWORK=1 npx playwright test downloads-network
 * They download a few MB at most (audio + a thumbnail).
 */
test.skip(process.env['BMAX_NETWORK'] !== '1', 'set BMAX_NETWORK=1 to run against the live internet')
test.setTimeout(300_000)

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
let h: Harness
let out: string
interface Job {
  id: string
  state: string
  file: string | null
  error?: string
}

test.beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'bmax-yt-'))
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1' })
  await inMain(h.app, `s.settings.update({ downloads: { ...s.settings.get().downloads, folder: arg } })`, out)
  await inMain(h.app, 's.windows.focused().go(arg)', 'https://example.com/')
  await sleep(2500)
})
test.afterAll(async () => {
  await h.close()
  rmSync(out, { recursive: true, force: true })
})

async function waitJob(id: string, ms = 240_000): Promise<Job> {
  const end = Date.now() + ms
  for (;;) {
    const j = (await inMain<Job[]>(h.app, 'return s.downloads.list()')).find((x) => x.id === id)
    if (j && ['done', 'error', 'cancelled'].includes(j.state)) return j
    if (Date.now() > end) throw new Error('timed out')
    await sleep(500)
  }
}

test('YouTube: probe shows qualities up to 4K, subtitles and playlist info', async () => {
  const p = await inMain<{ title: string; heights: number[]; hasAudio: boolean; subtitles: unknown[]; extractor: string; duration: number | null }>(
    h.app,
    'return await s.downloads.probe(s.windows.focused().activeTab, arg)',
    URL
  )
  console.log('probe:', p.title, 'heights', p.heights.slice(0, 6).join(','), 'subs', p.subtitles.length)
  expect(p.extractor).toBe('Youtube')
  expect(p.title.length).toBeGreaterThan(3)
  expect(Math.max(...p.heights)).toBeGreaterThanOrEqual(1080)
  expect(p.hasAudio).toBe(true)
  expect(p.duration).toBeGreaterThan(100)
})

test('YouTube: audio-only M4A download and a maximum-resolution thumbnail', async () => {
  const [aid] = await inMain<string[]>(
    h.app,
    `const tab = s.windows.focused().activeTab; return await s.downloads.startVideo(tab, arg, '', { mode: 'audio', height: null, container: 'mp4', audioFormat: 'm4a', subtitles: false, subLangs: [], thumbnail: false, playlist: false }, tab.url)`,
    URL
  )
  const audio = await waitJob(aid!)
  expect(audio.error).toBeUndefined()
  expect(audio.file).toMatch(/\.m4a$/)
  expect(durationOf(audio.file!)).toBeGreaterThan(200)

  const [tid] = await inMain<string[]>(h.app, 'const tab = s.windows.focused().activeTab; return await s.downloads.startThumbnail(tab, arg, "thumb")', URL)
  const thumb = await waitJob(tid!)
  expect(thumb.error).toBeUndefined()
  expect(thumb.file).toBeTruthy()
  expect(existsSync(thumb.file!)).toBe(true)
  const w = Number(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'default=nw=1:nk=1', thumb.file!], { encoding: 'utf8' }).trim())
  console.log('thumbnail width', w)
  expect(w).toBeGreaterThanOrEqual(1280) // maxresdefault
})

test('yt-dlp self-update check works (yt-dlp -U)', async () => {
  const r = await inMain<{ ok: boolean; message: string }>(h.app, 'return await s.downloads.updateYtdlp(null)')
  console.log('update:', r.message)
  expect(r.ok).toBe(true)
})
