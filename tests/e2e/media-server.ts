import { execFileSync } from 'node:child_process'
import { copyFileSync, createReadStream, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

export const FFMPEG = resolve(__dirname, '../../resources/bin/ffmpeg/win32-x64/ffmpeg.exe')
export const FFPROBE = resolve(__dirname, '../../resources/bin/ffmpeg/win32-x64/ffprobe.exe')

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mpd': 'application/dash+xml',
  '.m4s': 'video/iso.segment',
  '.png': 'image/png'
}

export function durationOf(file: string): number {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  return Number(out.trim())
}

export interface MediaServer {
  dir: string
  port: number
  origin: string
  clipBytes: number
  close(): Promise<void>
}

function ff(args: string[], cwd?: string): void {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'ignore', cwd })
}

/** Generates tiny real media files with the bundled ffmpeg and serves them (plain, throttled, HLS, DASH, images). */
export async function startMediaServer(): Promise<MediaServer> {
  const dir = mkdtempSync(join(tmpdir(), 'bmax-media-'))
  // 3 s, 640x360 test pattern + sine tone → h264/aac mp4 (~100 KB+)
  ff(['-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '600k', '-c:a', 'aac', '-shortest', join(dir, 'clip.mp4')])
  ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:a', 'libmp3lame', '-b:a', '128k', join(dir, 'tone.mp3')])
  mkdirSync(join(dir, 'hls'))
  ff(['-i', join(dir, 'clip.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(dir, 'hls', 'seg%d.ts'), join(dir, 'hls', 'index.m3u8')])
  mkdirSync(join(dir, 'dash'))
  // DASH writes its segments relative to the working directory, so run from the media folder with relative paths.
  ff(['-i', 'clip.mp4', '-c', 'copy', '-f', 'dash', '-seg_duration', '1', 'dash/manifest.mpd'], dir)
  for (const [name, size] of [['small', '50x50'], ['medium', '300x300'], ['large', '700x500']] as const) {
    ff(['-f', 'lavfi', '-i', `testsrc=size=${size}:rate=1`, '-frames:v', '1', join(dir, `${name}.png`)])
  }
  // Extra copies so tests that download the same media never collide on output file names.
  for (const n of ['clip-a', 'clip-b']) copyFileSync(join(dir, 'clip.mp4'), join(dir, `${n}.mp4`))
  const clipBytes = statSync(join(dir, 'clip.mp4')).size

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const page = (html: string): void => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    }
    if (path === '/media-page') {
      return page(`<!doctype html><title>Media Page</title><body>
        <video id="v" src="/clip.mp4" preload="auto" muted></video>
        <img src="/small.png" width="50" height="50"><img src="/medium.png"><img src="/large.png">
      </body>`)
    }
    if (path === '/hls-page') {
      return page(`<!doctype html><title>HLS Page</title><body><script>fetch('/hls/index.m3u8').then(r => r.text()).then(t => { window.__m3u8 = t.length })</script></body>`)
    }
    if (path === '/dash-page') {
      return page(`<!doctype html><title>DASH Page</title><body><script>fetch('/dash/manifest.mpd').then(r => r.text()).then(t => { window.__mpd = t.length })</script></body>`)
    }
    if (path === '/two-videos') {
      return page(`<!doctype html><title>Two Videos</title><body><video src="/clip-a.mp4" preload="none"></video><video src="/clip-b.mp4" preload="none"></video></body>`)
    }
    if (path === '/plain-page') return page('<!doctype html><title>Plain</title><body>no media here</body>')
    // static files, optionally throttled (/slow/<file>): ~16 KB/s with Range support so pause/resume can be tested
    const slow = path.startsWith('/slow/')
    const rel = slow ? path.slice(6) : path.slice(1)
    if (/\.\./.test(rel) || rel === '') {
      res.writeHead(404).end()
      return
    }
    const file = join(dir, rel)
    let size: number
    try {
      size = statSync(file).size
    } catch {
      res.writeHead(404).end()
      return
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream'
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''))
    let start = 0
    let end = size - 1
    const headers: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes' }
    if (range) {
      start = Number(range[1])
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
    } else {
      res.writeHead(200, { ...headers, 'content-length': size })
    }
    if (!slow) {
      createReadStream(file, { start, end }).pipe(res)
      return
    }
    const data = readFileSync(file).subarray(start, end + 1)
    let off = 0
    const timer = setInterval(() => {
      if (off >= data.length || res.destroyed) {
        clearInterval(timer)
        res.end()
        return
      }
      res.write(data.subarray(off, off + 4096))
      off += 4096
    }, 250)
    res.on('close', () => clearInterval(timer))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    dir,
    port,
    origin: `http://127.0.0.1:${port}`,
    clipBytes,
    close: () => new Promise((r) => server.close(() => r()))
  }
}
