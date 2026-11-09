import type { SniffedKind, VideoOptions } from '@shared/downloads'

/**
 * Pure helpers for building yt-dlp command lines and parsing its output.
 * Everything here returns argument ARRAYS (the process is spawned without a shell) and the URL always comes after `--`
 * so it can never be mistaken for an option.
 */
export interface ToolEnv {
  ffmpegDir: string | null
  /** e.g. socks5h://127.0.0.1:9050 (Tor window) or the user's proxy; null = direct. */
  proxy: string | null
  /** JavaScript runtime for YouTube (yt-dlp-ejs), as "node:/path/to/node". */
  jsRuntime: string | null
  referer?: string | undefined
}

export function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''
  } catch {
    return false
  }
}

/** Output file name template: capped length, Windows-safe characters. */
export const OUTPUT_TEMPLATE = '%(title).150B [%(id)s].%(ext)s'
export const PLAYLIST_TEMPLATE = '%(playlist_title).100B/%(playlist_index)03d - %(title).120B [%(id)s].%(ext)s'

const COMMON = ['--ignore-config', '--no-cache-dir', '--no-mtime', '--no-colors', '--windows-filenames', '--trim-filenames', '200', '--retries', '10', '--fragment-retries', '10']

function envArgs(env: ToolEnv): string[] {
  const a: string[] = []
  if (env.ffmpegDir) a.push('--ffmpeg-location', env.ffmpegDir)
  if (env.proxy) a.push('--proxy', env.proxy)
  if (env.jsRuntime) a.push('--js-runtimes', env.jsRuntime)
  if (env.referer && isHttpUrl(env.referer)) a.push('--referer', env.referer)
  return a
}

/** yt-dlp format selector for a max height and container preference. */
export function formatSelector(height: number | null, container: 'mp4' | 'webm'): string {
  const h = height === null ? '' : `[height<=${Math.round(height)}]`
  const ext = container === 'mp4' ? ['mp4', 'm4a'] : ['webm', 'webm']
  return `bv*${h}[ext=${ext[0]}]+ba[ext=${ext[1]}]/bv*${h}+ba/b${h}/b`
}

export function buildProbeArgs(url: string, flatPlaylist: boolean, env: ToolEnv): string[] {
  return [
    ...COMMON,
    ...envArgs(env),
    '-J',
    '--no-warnings',
    flatPlaylist ? '--flat-playlist' : '--no-playlist',
    '--socket-timeout',
    '20',
    '--',
    url
  ]
}

export function buildDownloadArgs(url: string, opts: VideoOptions, outDir: string, tmpDir: string, env: ToolEnv): string[] {
  const args: string[] = [...COMMON, ...envArgs(env), '--newline', '--progress', '--no-warnings', '-P', outDir, '-P', `temp:${tmpDir}`]
  args.push('--progress-template', 'download:BMAXP|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.vcodec)s|%(info.acodec)s')
  args.push('--print', 'before_dl:BMAXC|%(format_id)s', '--print', 'before_dl:BMAXI|%(playlist_index)s|%(n_entries)s|%(title)s', '--print', 'after_move:BMAXF|%(filepath)s')
  args.push('-o', opts.playlist ? PLAYLIST_TEMPLATE : OUTPUT_TEMPLATE)
  args.push(opts.playlist ? '--yes-playlist' : '--no-playlist')

  if (opts.mode === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', opts.audioFormat, '--audio-quality', '0')
  } else {
    args.push('-f', formatSelector(opts.height, opts.container), '--merge-output-format', opts.container)
  }
  if (opts.subtitles) {
    const langs = opts.subLangs.filter((l) => /^[A-Za-z0-9_.*-]{1,32}$/.test(l))
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', langs.length ? langs.join(',') : 'en.*', '--convert-subs', 'srt')
  }
  if (opts.thumbnail) args.push('--write-thumbnail', '--convert-thumbnails', 'jpg')
  args.push('--', url)
  return args
}

/** Only the thumbnail, in the best available resolution. */
export function buildThumbnailArgs(url: string, outDir: string, tmpDir: string, env: ToolEnv): string[] {
  return [
    ...COMMON,
    ...envArgs(env),
    '--newline',
    '--no-warnings',
    '--skip-download',
    '--write-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '--no-playlist',
    '-P',
    outDir,
    '-P',
    `temp:${tmpDir}`,
    '-o',
    'thumbnail:%(title).150B [%(id)s].%(ext)s',
    '--',
    url
  ]
}

/** HLS / DASH manifests (and direct files) found by the network sniffer, downloaded and merged by yt-dlp + ffmpeg. */
export function buildStreamArgs(url: string, outDir: string, tmpDir: string, env: ToolEnv): string[] {
  return [
    ...COMMON,
    ...envArgs(env),
    '--newline',
    '--progress',
    '--no-warnings',
    '--no-playlist',
    '-P',
    outDir,
    '-P',
    `temp:${tmpDir}`,
    '--progress-template',
    'download:BMAXP|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.vcodec)s|%(info.acodec)s',
    '--print',
    'after_move:BMAXF|%(filepath)s',
    '--merge-output-format',
    'mp4',
    '-o',
    '%(title).150B [%(id)s].%(ext)s',
    '--',
    url
  ]
}

// ------------------------------------------------------------------ output parsing

export type ParsedLine =
  | { type: 'progress'; status: string; downloaded: number; total: number | null; speed: number | null; eta: number | null; stage: string }
  | { type: 'formats'; count: number }
  | { type: 'item'; index: number | null; of: number | null; title: string }
  | { type: 'file'; path: string }

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === 'NA' || s === 'None' || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function parseOutputLine(line: string): ParsedLine | null {
  const l = line.trim()
  if (l.startsWith('BMAXP|')) {
    const p = l.split('|')
    const total = num(p[3]) ?? num(p[4])
    const v = p[7] ?? ''
    const a = p[8] ?? ''
    const stage = a === 'none' ? 'Video' : v === 'none' ? 'Audio' : 'Media'
    return { type: 'progress', status: p[1] ?? '', downloaded: num(p[2]) ?? 0, total, speed: num(p[5]), eta: num(p[6]), stage }
  }
  if (l.startsWith('BMAXC|')) {
    const id = l.slice(6)
    return { type: 'formats', count: id.split('+').filter(Boolean).length || 1 }
  }
  if (l.startsWith('BMAXI|')) {
    const p = l.split('|')
    return { type: 'item', index: num(p[1]), of: num(p[2]), title: p.slice(3).join('|') }
  }
  if (l.startsWith('BMAXF|')) {
    const path = l.slice(6).trim()
    return path && path !== 'NA' ? { type: 'file', path } : null
  }
  return null
}

// ------------------------------------------------------------------ network media classification

const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|ogv|avi)$/i
const AUDIO_EXT = /\.(mp3|m4a|ogg|oga|opus|wav|flac|aac)$/i
const MIN_FILE_BYTES = 20 * 1024

/**
 * Decide whether a network response is downloadable media. HLS/DASH segments and tiny files are ignored;
 * manifests (.m3u8 / .mpd) are reported as one item.
 */
export function classifyMedia(url: string, mime: string, size: number | null): SniffedKind | null {
  let path: string
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    path = u.pathname
    host = u.hostname
  } catch {
    return null
  }
  const m = mime.toLowerCase().split(';')[0]!.trim()
  if (host.endsWith('googlevideo.com') || /\/videoplayback$/.test(path)) return null // handled through the page URL by yt-dlp
  if (/\.(ts|m4s|cmfv|cmfa|cmft|mts)$/i.test(path) || m === 'video/mp2t' || m === 'video/iso.segment') return null
  if (m === 'application/vnd.apple.mpegurl' || m === 'application/x-mpegurl' || m === 'audio/mpegurl' || m === 'audio/x-mpegurl' || /\.m3u8$/i.test(path)) return 'hls'
  if (m === 'application/dash+xml' || /\.mpd$/i.test(path)) return 'dash'
  const big = size === null || size >= MIN_FILE_BYTES
  if (m.startsWith('video/') || VIDEO_EXT.test(path)) return big ? 'video' : null
  if (m.startsWith('audio/') || AUDIO_EXT.test(path)) return big ? 'audio' : null
  return null
}

/** Safe file name part from an arbitrary string. */
export function sanitizeFileName(name: string, fallback = 'download'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150)
  if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) return fallback
  return cleaned
}
