import { describe, expect, it } from 'vitest'
import {
  buildDownloadArgs,
  buildProbeArgs,
  buildStreamArgs,
  buildThumbnailArgs,
  classifyMedia,
  formatSelector,
  isHttpUrl,
  parseOutputLine,
  sanitizeFileName
} from '../../src/main/downloads/args'
import type { ToolEnv } from '../../src/main/downloads/args'
import type { VideoOptions } from '@shared/downloads'
import { formatBytes, formatEta, qualityLabel, qualityOptions } from '@shared/downloads'

const ENV: ToolEnv = { ffmpegDir: 'C:/bin/ffmpeg', proxy: null, jsRuntime: 'node:C:/app/electron.exe' }
const OPTS: VideoOptions = { mode: 'video', height: 2160, container: 'mp4', audioFormat: 'mp3', subtitles: false, subLangs: [], thumbnail: false, playlist: false }

describe('yt-dlp argument builders', () => {
  it('puts the URL after "--" so it can never be read as an option', () => {
    for (const evil of ['--exec calc', '-o /etc/passwd', 'https://example.com/a b']) {
      const args = buildDownloadArgs(evil, OPTS, 'C:/out', 'C:/tmp', ENV)
      expect(args[args.length - 2]).toBe('--')
      expect(args[args.length - 1]).toBe(evil)
      expect(args.filter((a) => a === evil)).toHaveLength(1)
    }
    expect(buildProbeArgs('--version', false, ENV).slice(-2)).toEqual(['--', '--version'])
  })

  it('selects quality and container', () => {
    expect(formatSelector(2160, 'mp4')).toBe('bv*[height<=2160][ext=mp4]+ba[ext=m4a]/bv*[height<=2160]+ba/b[height<=2160]/b')
    expect(formatSelector(null, 'webm')).toBe('bv*[ext=webm]+ba[ext=webm]/bv*+ba/b/b')
    const mp4 = buildDownloadArgs('https://e.example/v', OPTS, 'C:/out', 'C:/tmp', ENV)
    expect(mp4).toContain('--merge-output-format')
    expect(mp4[mp4.indexOf('--merge-output-format') + 1]).toBe('mp4')
    const webm = buildDownloadArgs('https://e.example/v', { ...OPTS, container: 'webm', height: 4320 }, 'C:/out', 'C:/tmp', ENV)
    expect(webm[webm.indexOf('--merge-output-format') + 1]).toBe('webm')
    expect(webm[webm.indexOf('-f') + 1]).toContain('height<=4320')
  })

  it('audio-only extracts MP3 or M4A', () => {
    for (const fmt of ['mp3', 'm4a'] as const) {
      const a = buildDownloadArgs('https://e.example/v', { ...OPTS, mode: 'audio', audioFormat: fmt }, 'C:/out', 'C:/tmp', ENV)
      expect(a).toContain('-x')
      expect(a[a.indexOf('--audio-format') + 1]).toBe(fmt)
      expect(a).not.toContain('--merge-output-format')
    }
  })

  it('subtitles, thumbnail and playlist options', () => {
    const a = buildDownloadArgs('https://e.example/v', { ...OPTS, subtitles: true, subLangs: ['en', 'de.*', 'bad lang;rm'], thumbnail: true, playlist: true }, 'C:/out', 'C:/tmp', ENV)
    expect(a).toContain('--write-subs')
    expect(a[a.indexOf('--sub-langs') + 1]).toBe('en,de.*') // invalid language codes dropped
    expect(a).toContain('--write-thumbnail')
    expect(a).toContain('--yes-playlist')
    expect(a[a.indexOf('-o') + 1]).toContain('playlist_index')
    const single = buildDownloadArgs('https://e.example/v', OPTS, 'C:/out', 'C:/tmp', ENV)
    expect(single).toContain('--no-playlist')
    expect(single).not.toContain('--write-subs')
  })

  it('never reads user config or caches, and routes through the proxy / ffmpeg / JS runtime when given', () => {
    const a = buildDownloadArgs('https://e.example/v', OPTS, 'C:/out', 'C:/tmp', { ...ENV, proxy: 'socks5h://127.0.0.1:9050', referer: 'https://page.example/' })
    expect(a).toContain('--ignore-config')
    expect(a).toContain('--no-cache-dir')
    expect(a[a.indexOf('--proxy') + 1]).toBe('socks5h://127.0.0.1:9050')
    expect(a[a.indexOf('--ffmpeg-location') + 1]).toBe('C:/bin/ffmpeg')
    expect(a[a.indexOf('--js-runtimes') + 1]).toBe('node:C:/app/electron.exe')
    expect(a[a.indexOf('--referer') + 1]).toBe('https://page.example/')
    const direct = buildDownloadArgs('https://e.example/v', OPTS, 'C:/out', 'C:/tmp', { ffmpegDir: null, proxy: null, jsRuntime: null })
    expect(direct).not.toContain('--proxy')
    expect(direct).not.toContain('--ffmpeg-location')
  })

  it('thumbnail-only and stream builders', () => {
    const t = buildThumbnailArgs('https://e.example/v', 'C:/out', 'C:/tmp', ENV)
    expect(t).toContain('--skip-download')
    expect(t).toContain('--write-thumbnail')
    const s = buildStreamArgs('https://e.example/master.m3u8', 'C:/out', 'C:/tmp', { ...ENV, referer: 'https://e.example/' })
    expect(s.slice(-2)).toEqual(['--', 'https://e.example/master.m3u8'])
    expect(s[s.indexOf('--merge-output-format') + 1]).toBe('mp4')
  })

  it('validates URLs', () => {
    expect(isHttpUrl('https://a.example/x')).toBe(true)
    for (const bad of ['file:///c:/a', 'javascript:1', 'ftp://a.example', 'not a url', '']) expect(isHttpUrl(bad), bad).toBe(false)
  })
})

describe('yt-dlp output parsing', () => {
  it('parses progress lines (video, audio, unknown values)', () => {
    expect(parseOutputLine('BMAXP|downloading|1048576|4194304|NA|2097152.5|2|avc1.64001f|none')).toEqual({
      type: 'progress', status: 'downloading', downloaded: 1048576, total: 4194304, speed: 2097152.5, eta: 2, stage: 'Video'
    })
    expect(parseOutputLine('BMAXP|downloading|500|NA|1000|NA|NA|none|opus')).toMatchObject({ total: 1000, speed: null, eta: null, stage: 'Audio' })
    expect(parseOutputLine('BMAXP|finished|900|900|NA|NA|NA|avc1|mp4a')).toMatchObject({ status: 'finished', stage: 'Media' })
  })
  it('parses format counts, playlist items and output files', () => {
    expect(parseOutputLine('BMAXC|137+140')).toEqual({ type: 'formats', count: 2 })
    expect(parseOutputLine('BMAXC|18')).toEqual({ type: 'formats', count: 1 })
    expect(parseOutputLine('BMAXI|3|12|Some | title')).toEqual({ type: 'item', index: 3, of: 12, title: 'Some | title' })
    expect(parseOutputLine('BMAXF|C:\\out\\a [x].mp4')).toEqual({ type: 'file', path: 'C:\\out\\a [x].mp4' })
    expect(parseOutputLine('BMAXF|NA')).toBeNull()
    expect(parseOutputLine('[download] 50%')).toBeNull()
  })
})

describe('network media classification', () => {
  it('recognises video, audio and manifests by MIME type or extension', () => {
    expect(classifyMedia('https://c.example/a.mp4', 'video/mp4', 5_000_000)).toBe('video')
    expect(classifyMedia('https://c.example/a', 'video/webm', null)).toBe('video')
    expect(classifyMedia('https://c.example/a.mp3', 'audio/mpeg', 4_000_000)).toBe('audio')
    expect(classifyMedia('https://c.example/a.m4a?x=1', 'application/octet-stream', 4_000_000)).toBe('audio')
    expect(classifyMedia('https://c.example/master.m3u8?token=1', 'application/vnd.apple.mpegurl', 800)).toBe('hls')
    expect(classifyMedia('https://c.example/stream', 'application/x-mpegURL', 800)).toBe('hls')
    expect(classifyMedia('https://c.example/manifest.mpd', 'application/dash+xml', 900)).toBe('dash')
  })
  it('ignores segments, tiny files, non-media and YouTube video chunks', () => {
    expect(classifyMedia('https://c.example/seg1.ts', 'video/mp2t', 900_000)).toBeNull()
    expect(classifyMedia('https://c.example/seg1.m4s', 'video/mp4', 900_000)).toBeNull()
    expect(classifyMedia('https://c.example/ping.mp4', 'video/mp4', 300)).toBeNull()
    expect(classifyMedia('https://c.example/page.html', 'text/html', 5000)).toBeNull()
    expect(classifyMedia('https://rr1---sn-x.googlevideo.com/videoplayback?id=1', 'video/mp4', 9_000_000)).toBeNull()
    expect(classifyMedia('ftp://c.example/a.mp4', 'video/mp4', 9_000_000)).toBeNull()
  })
})

describe('helpers', () => {
  it('sanitizes file names', () => {
    expect(sanitizeFileName('a<b>:c"/d\\e|f?g*')).toBe('a_b_c_d_e_f_g_')
    expect(sanitizeFileName('CON')).toBe('download')
    expect(sanitizeFileName('...')).toBe('download')
    expect(sanitizeFileName('x'.repeat(400)).length).toBe(150)
  })
  it('offers the quality steps a video actually has', () => {
    expect(qualityOptions([360, 720, 1080])).toEqual([1080, 720, 480, 360, 240, 144])
    expect(qualityOptions([2160, 1080])).toEqual([2160, 1440, 1080, 720, 480, 360, 240, 144])
    expect(qualityOptions([])).toEqual([])
    expect(qualityLabel(4320)).toBe('8K (4320p)')
    expect(qualityLabel(2160)).toBe('4K (2160p)')
    expect(qualityLabel(720)).toBe('720p')
  })
  it('formats sizes and times', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB')
    expect(formatEta(75)).toBe('1m 15s')
    expect(formatEta(null)).toBe('')
  })
})
