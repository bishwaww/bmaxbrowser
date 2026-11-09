import { app, shell } from 'electron'
import type { DownloadItem, Session, WebContents } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, parse as parsePath } from 'node:path'
import { tmpdir } from 'node:os'
import { proxyRules } from '@shared/privacy'
import type { DownloadJob, ImageCandidate, ProbeResult, SubtitleLang, VideoOptions } from '@shared/downloads'
import { registry } from '../app/registry'
import { services } from '../services'
import type { Tab } from '../tabs/Tab'
import {
  buildDownloadArgs,
  buildProbeArgs,
  buildStreamArgs,
  buildThumbnailArgs,
  isHttpUrl,
  parseOutputLine,
  sanitizeFileName
} from './args'
import type { ToolEnv } from './args'
import {
  ensureYtdlp,
  ffmpegDir,
  jsRuntimeSpec,
  killTree,
  resetVersionCache,
  runCapture,
  toolProcessEnv,
  writeToolMeta
} from './tools'

interface Runtime {
  job: DownloadJob
  kind: 'ytdlp' | 'electron' | 'images'
  /** yt-dlp */
  args?: string[]
  proc?: ChildProcess
  tmpDir?: string
  streamsFinished: number
  formats: number
  itemIndex: number | null
  itemTotal: number | null
  files: string[]
  stderrTail: string[]
  /** we stopped it on purpose (pause / cancel) */
  stopping: 'pause' | 'cancel' | null
  /** Electron download */
  item?: DownloadItem
  /** image batch */
  abort?: AbortController
  start?: () => void
}

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico'
}

function uniquePath(dir: string, name: string): string {
  const { name: stem, ext } = parsePath(name)
  let candidate = join(dir, name)
  for (let i = 1; existsSync(candidate) && i < 1000; i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

/**
 * Owns every download: yt-dlp video/audio/stream jobs, plain file downloads from the browser engine, and image batches.
 * Jobs live in memory only (nothing about downloads is stored); files stay on disk.
 */
export class DownloadManager extends EventEmitter {
  private jobs = new Map<string, Runtime>()
  private order: string[] = []
  private emitTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
    // Leftover partial-download folders from a previous run that was killed (single-instance app: none can be in use).
    try {
      for (const name of readdirSync(tmpdir())) {
        if (name.startsWith('bmax-dljob-')) rmSync(join(tmpdir(), name), { recursive: true, force: true })
      }
    } catch {
      /* best effort */
    }
  }

  // ------------------------------------------------------------------ public API

  list(): DownloadJob[] {
    return this.order.map((id) => this.jobs.get(id)?.job).filter((j): j is DownloadJob => !!j).map((j) => ({ ...j })).reverse()
  }

  folder(): string {
    const f = services.settings.get().downloads.folder
    const dir = f && existsSync(f) ? f : app.getPath('downloads')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private changed(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit('change', this.list())
    }, 200)
  }

  private add(rt: Runtime): void {
    this.jobs.set(rt.job.id, rt)
    this.order.push(rt.job.id)
    this.changed()
  }

  private newJob(kind: DownloadJob['kind'], title: string, url: string, viaTor: boolean): DownloadJob {
    return {
      id: randomUUID(),
      kind,
      title,
      url,
      state: 'queued',
      progress: -1,
      stage: '',
      speed: null,
      eta: null,
      bytes: 0,
      total: null,
      file: null,
      startedAt: Date.now(),
      fileCount: 0,
      viaTor
    }
  }

  // ------------------------------------------------------------------ environment per tab

  /** Proxy yt-dlp must use for this tab: Tor (remote DNS) in Tor windows, the user's proxy otherwise, else direct. */
  proxyFor(tab: Tab): string | null {
    if (tab.window.tor) {
      if (!services.tor.isReady()) throw new Error('Tor is not connected yet.')
      return `socks5h://127.0.0.1:${services.tor.socksPort()}`
    }
    const p = services.settings.get().proxy
    const rules = proxyRules(p)
    if (p.enabled && !rules) throw new Error('The proxy settings are invalid.')
    if (!rules) return null
    return rules.replace(/^socks5:/, 'socks5h:')
  }

  private toolEnv(tab: Tab, referer?: string): ToolEnv {
    return { ffmpegDir: ffmpegDir(), proxy: this.proxyFor(tab), jsRuntime: jsRuntimeSpec(), referer }
  }

  // ------------------------------------------------------------------ yt-dlp: probe

  async probe(tab: Tab, url: string): Promise<ProbeResult> {
    if (!isHttpUrl(url)) throw new Error('Only web addresses can be analysed.')
    const bin = await ensureYtdlp()
    if (!bin) throw new Error('yt-dlp is not installed (see docs/BINARIES.md).')
    const env = this.toolEnv(tab, undefined)
    const looksPlaylist = /[?&]list=|\/playlist\b/.test(url)
    const single = await runCapture(bin, buildProbeArgs(url, false, env), { timeoutMs: 90_000 })
    if (single.code !== 0) {
      const err = single.stderr.split(/\r?\n/).filter((l) => /ERROR/i.test(l)).pop() ?? single.stderr.trim().split(/\r?\n/).pop() ?? 'yt-dlp failed'
      throw new Error(err.replace(/^ERROR:\s*/i, '').slice(0, 300))
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let info: any
    try {
      info = JSON.parse(single.stdout)
    } catch {
      throw new Error('Could not read the media information.')
    }
    let playlistCount = 0
    if (info._type === 'playlist') playlistCount = (info.entries ?? []).length
    else if (looksPlaylist) {
      const flat = await runCapture(bin, buildProbeArgs(url, true, env), { timeoutMs: 60_000 })
      try {
        const f = JSON.parse(flat.stdout)
        if (f._type === 'playlist') playlistCount = (f.entries ?? []).length
      } catch {
        /* single video only */
      }
    }
    const src = info._type === 'playlist' ? ((info.entries ?? [])[0] ?? {}) : info
    const heights = new Set<number>()
    let hasAudio = false
    for (const f of (src.formats ?? []) as { height?: number; vcodec?: string; acodec?: string }[]) {
      if (f.height && f.vcodec && f.vcodec !== 'none') heights.add(f.height)
      if (f.acodec && f.acodec !== 'none') hasAudio = true
    }
    if (heights.size === 0 && typeof src.height === 'number') heights.add(src.height)
    const subtitles: SubtitleLang[] = []
    for (const [code, v] of Object.entries((src.subtitles ?? {}) as Record<string, { name?: string }[]>)) {
      subtitles.push({ code, name: v[0]?.name ?? code, auto: false })
    }
    const auto = Object.entries((src.automatic_captions ?? {}) as Record<string, { name?: string }[]>)
    for (const [code, v] of auto.slice(0, 40)) {
      if (!subtitles.some((s) => s.code === code)) subtitles.push({ code, name: v[0]?.name ?? code, auto: true })
    }
    return {
      url,
      title: String(info.title ?? src.title ?? url).slice(0, 300),
      thumbnail: typeof (src.thumbnail ?? info.thumbnail) === 'string' ? (src.thumbnail ?? info.thumbnail) : null,
      duration: typeof src.duration === 'number' ? src.duration : null,
      uploader: (src.uploader ?? info.uploader ?? null) as string | null,
      extractor: String(info.extractor_key ?? info.extractor ?? 'generic'),
      isPlaylist: playlistCount > 1,
      playlistCount,
      heights: [...heights].sort((a, b) => b - a),
      hasAudio,
      subtitles
    }
  }

  // ------------------------------------------------------------------ yt-dlp: jobs

  async startVideo(tab: Tab, url: string, title: string, options: VideoOptions, referer?: string): Promise<string[]> {
    const env = this.toolEnv(tab, referer)
    const id = this.queueYtdlp(tab, options.mode === 'audio' ? 'audio' : 'video', title || url, url, (out, tmp) => buildDownloadArgs(url, options, out, tmp, env))
    return [id]
  }

  async startThumbnail(tab: Tab, url: string, title: string): Promise<string[]> {
    const env = this.toolEnv(tab, undefined)
    return [this.queueYtdlp(tab, 'thumbnail', `Thumbnail: ${title || url}`, url, (out, tmp) => buildThumbnailArgs(url, out, tmp, env))]
  }

  async startStream(tab: Tab, url: string, title: string, referer: string): Promise<string[]> {
    const env = this.toolEnv(tab, referer)
    return [this.queueYtdlp(tab, 'video', title || url, url, (out, tmp) => buildStreamArgs(url, out, tmp, env))]
  }

  private queueYtdlp(tab: Tab, kind: DownloadJob['kind'], title: string, url: string, build: (out: string, tmp: string) => string[]): string {
    if (!isHttpUrl(url)) throw new Error('Only web addresses can be downloaded.')
    const job = this.newJob(kind, title, url, tab.window.tor)
    const tmpDir = join(tmpdir(), `bmax-dljob-${job.id}`)
    const rt: Runtime = {
      job,
      kind: 'ytdlp',
      args: build(this.folder(), tmpDir),
      tmpDir,
      streamsFinished: 0,
      formats: 1,
      itemIndex: null,
      itemTotal: null,
      files: [],
      stderrTail: [],
      stopping: null
    }
    this.add(rt)
    this.pump()
    return job.id
  }

  private running(): number {
    let n = 0
    for (const rt of this.jobs.values()) if (rt.job.state === 'starting' || rt.job.state === 'downloading' || rt.job.state === 'processing') n++
    return n
  }

  private pump(): void {
    const max = services.settings.get().downloads.maxConcurrent
    for (const id of this.order) {
      if (this.running() >= max) return
      const rt = this.jobs.get(id)
      if (rt && rt.job.state === 'queued' && rt.kind === 'ytdlp') void this.runYtdlp(rt)
    }
  }

  private async runYtdlp(rt: Runtime): Promise<void> {
    const job = rt.job
    job.state = 'starting'
    job.stage = 'Starting…'
    this.changed()
    const bin = await ensureYtdlp()
    if (!bin || !rt.args) {
      this.fail(rt, 'yt-dlp is not installed (see docs/BINARIES.md).')
      return
    }
    if (rt.tmpDir) mkdirSync(rt.tmpDir, { recursive: true })
    rt.stopping = null
    rt.stderrTail = []
    const proc = spawn(bin, rt.args, { windowsHide: true, env: toolProcessEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    rt.proc = proc
    let buf = ''
    proc.stdout?.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        this.onLine(rt, buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })
    let errBuf = ''
    proc.stderr?.on('data', (d: Buffer) => {
      errBuf += d.toString('utf8')
      let nl: number
      while ((nl = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, nl).trim()
        errBuf = errBuf.slice(nl + 1)
        if (line) rt.stderrTail = [...rt.stderrTail.slice(-6), line]
      }
    })
    proc.on('error', (e) => this.fail(rt, e.message))
    proc.on('close', (code) => {
      if (buf.trim()) this.onLine(rt, buf)
      rt.proc = undefined
      if (rt.stopping === 'pause') {
        job.state = 'paused'
        job.speed = null
        job.eta = null
        job.stage = 'Paused'
        this.changed()
        this.pump()
        return
      }
      if (rt.stopping === 'cancel') {
        this.finishCancelled(rt)
        return
      }
      if (code === 0) {
        job.state = 'done'
        job.progress = 1
        job.stage = 'Done'
        job.speed = null
        job.eta = null
        job.finishedAt = Date.now()
        job.fileCount = rt.files.length
        job.file = rt.files[rt.files.length - 1] ?? null
        if (job.kind === 'thumbnail' && !job.file) {
          // --skip-download never reaches yt-dlp's after_move hook, so find the image it just wrote.
          job.file = this.newestImageSince(job.startedAt - 2000)
          job.fileCount = job.file ? 1 : 0
        }
        this.cleanupTmp(rt)
      } else {
        const err = [...rt.stderrTail].reverse().find((l) => /ERROR/i.test(l)) ?? rt.stderrTail[rt.stderrTail.length - 1] ?? `yt-dlp exited with code ${code}`
        this.fail(rt, err.replace(/^ERROR:\s*/i, '').slice(0, 300))
      }
      this.changed()
      this.pump()
    })
  }

  private onLine(rt: Runtime, line: string): void {
    const p = parseOutputLine(line)
    const job = rt.job
    if (!p) return
    if (p.type === 'formats') {
      rt.formats = p.count
      rt.streamsFinished = 0
      return
    }
    if (p.type === 'item') {
      rt.itemIndex = p.index
      rt.itemTotal = p.of
      rt.streamsFinished = 0
      if (p.title && p.title !== 'NA') job.title = p.title
      if (p.of && p.of > 1) job.stage = `Item ${p.index ?? '?'} of ${p.of}`
      return
    }
    if (p.type === 'file') {
      rt.files.push(p.path)
      if (job.kind !== 'thumbnail') job.title = basename(p.path)
      job.fileCount = rt.files.length
      job.file = p.path
      this.changed()
      return
    }
    // progress
    job.state = 'downloading'
    job.bytes = p.downloaded
    job.total = p.total
    job.speed = p.speed
    job.eta = p.eta
    if (!rt.itemTotal) job.stage = rt.formats > 1 ? `${p.stage} (${Math.min(rt.streamsFinished + 1, rt.formats)}/${rt.formats})` : p.stage
    const frac = p.total ? Math.min(1, p.downloaded / p.total) : 0
    const streamPart = (Math.min(rt.streamsFinished, rt.formats - 1) + frac) / rt.formats
    const itemDone = rt.itemTotal && rt.itemIndex ? rt.itemIndex - 1 : 0
    job.progress = rt.itemTotal ? Math.min(0.999, (itemDone + streamPart) / rt.itemTotal) : p.total ? Math.min(0.999, streamPart) : -1
    if (p.status === 'finished') {
      rt.streamsFinished++
      if (rt.streamsFinished >= rt.formats && !rt.itemTotal) {
        job.state = 'processing'
        job.stage = 'Merging / converting…'
      }
    }
    this.changed()
  }

  private fail(rt: Runtime, message: string): void {
    rt.job.state = 'error'
    rt.job.error = message
    rt.job.speed = null
    rt.job.eta = null
    rt.job.finishedAt = Date.now()
    this.cleanupTmp(rt)
    this.changed()
    this.pump()
  }

  private finishCancelled(rt: Runtime): void {
    rt.job.state = 'cancelled'
    rt.job.stage = 'Cancelled'
    rt.job.speed = null
    rt.job.eta = null
    rt.job.finishedAt = Date.now()
    this.cleanupTmp(rt)
    this.changed()
    this.pump()
  }

  private newestImageSince(sinceMs: number): string | null {
    const dir = this.folder()
    let best: { p: string; t: number } | null = null
    try {
      for (const name of readdirSync(dir)) {
        if (!/.(jpe?g|png|webp)$/i.test(name)) continue
        const p = join(dir, name)
        const t = statSync(p).mtimeMs
        if (t >= sinceMs && (!best || t > best.t)) best = { p, t }
      }
    } catch {
      /* folder unreadable */
    }
    return best?.p ?? null
  }

  private cleanupTmp(rt: Runtime): void {
    if (!rt.tmpDir) return
    const dir = rt.tmpDir
    // yt-dlp / ffmpeg may still hold files for a moment after being killed.
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      } catch {
        /* best effort */
      }
    }, 800).unref()
  }

  // ------------------------------------------------------------------ plain file downloads (browser engine)

  /** Hook for `session.on('will-download')`: save without a dialog into the downloads folder (unless the user wants to be asked). */
  onWillDownload(item: DownloadItem, wc: WebContents | null): void {
    const info = wc ? registry.get(wc.id) : undefined
    const viaTor = info?.role === 'tab' ? info.tab.window.tor : false
    // .torrent files are not saved: they open in the torrent manager (and are refused in Tor windows).
    if (/\.torrent$/i.test(item.getFilename()) || item.getMimeType() === 'application/x-bittorrent') {
      services.torrents.interceptTorrentDownload(item, info?.role === 'tab' ? info.tab : null)
      return
    }
    const name = sanitizeFileName(item.getFilename(), 'download')
    const job = this.newJob('file', name, item.getURL(), viaTor)
    job.state = 'starting'
    const rt: Runtime = { job, kind: 'electron', item, streamsFinished: 0, formats: 1, itemIndex: null, itemTotal: null, files: [], stderrTail: [], stopping: null }
    const settings = services.settings.get().downloads
    if (!settings.askWhere) {
      const path = uniquePath(this.folder(), name)
      item.setSavePath(path)
      job.file = path
    }
    this.add(rt)

    let lastBytes = 0
    let lastTime = Date.now()
    item.on('updated', (_e, state) => {
      const now = Date.now()
      const received = item.getReceivedBytes()
      const total = item.getTotalBytes()
      if (item.getSavePath()) job.file = item.getSavePath()
      job.title = basename(job.file ?? name)
      job.bytes = received
      job.total = total > 0 ? total : null
      job.progress = total > 0 ? received / total : -1
      if (now - lastTime >= 400) {
        job.speed = ((received - lastBytes) / (now - lastTime)) * 1000
        job.eta = job.speed > 0 && total > 0 ? (total - received) / job.speed : null
        lastBytes = received
        lastTime = now
      }
      if (state === 'interrupted') {
        job.state = item.canResume() ? 'paused' : 'error'
        job.stage = item.canResume() ? 'Interrupted' : 'Interrupted'
      } else if (item.isPaused()) {
        job.state = 'paused'
        job.stage = 'Paused'
        job.speed = null
      } else {
        job.state = 'downloading'
        job.stage = 'Downloading'
      }
      this.changed()
    })
    item.once('done', (_e, state) => {
      job.speed = null
      job.eta = null
      job.finishedAt = Date.now()
      if (state === 'completed') {
        job.state = 'done'
        job.progress = 1
        job.stage = 'Done'
        job.fileCount = 1
        job.file = item.getSavePath() || job.file
      } else if (state === 'cancelled') {
        job.state = 'cancelled'
        job.stage = 'Cancelled'
      } else {
        job.state = 'error'
        job.error = 'The download was interrupted.'
      }
      rt.item = undefined
      this.changed()
    })
  }

  // ------------------------------------------------------------------ image batches

  async saveImages(tab: Tab, images: ImageCandidate[]): Promise<string | null> {
    if (images.length === 0) return null
    let host = 'page'
    try {
      host = new URL(tab.url).hostname.replace(/^www\./, '')
    } catch {
      /* keep default */
    }
    const dir = uniquePath(this.folder(), sanitizeFileName(`${host} images`, 'images'))
    mkdirSync(dir, { recursive: true })
    const job = this.newJob('images', `${images.length} images from ${host}`, tab.url, tab.window.tor)
    job.state = 'downloading'
    job.stage = 'Saving images'
    job.file = dir
    job.total = images.length
    const abort = new AbortController()
    const rt: Runtime = { job, kind: 'images', abort, streamsFinished: 0, formats: 1, itemIndex: null, itemTotal: null, files: [], stderrTail: [], stopping: null }
    this.add(rt)
    const ses: Session = tab.session
    let next = 0
    let ok = 0
    let failed = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++
        const img = images[i]
        if (!img || abort.signal.aborted) return
        try {
          const { bytes, ext } = await this.fetchImage(ses, img.url, tab.url, abort.signal)
          const base = sanitizeFileName(decodeURIComponent((img.url.split('?')[0] ?? '').split('/').pop() ?? '') || `image-${i + 1}`, `image-${i + 1}`)
          const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '')
          const file = uniquePath(dir, `${stem}${ext}`)
          writeFileSync(file, bytes)
          ok++
        } catch {
          failed++
        }
        job.bytes = ok + failed
        job.progress = (ok + failed) / images.length
        job.fileCount = ok
        this.changed()
      }
    }
    void Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      if (rt.stopping === 'cancel') {
        job.state = 'cancelled'
        job.stage = 'Cancelled'
      } else if (ok === 0) {
        job.state = 'error'
        job.error = 'No image could be downloaded.'
      } else {
        job.state = 'done'
        job.progress = 1
        job.stage = failed ? `Done (${failed} failed)` : 'Done'
      }
      job.finishedAt = Date.now()
      this.changed()
    })
    return job.id
  }

  private async fetchImage(ses: Session, url: string, referer: string, signal: AbortSignal): Promise<{ bytes: Buffer; ext: string }> {
    if (url.startsWith('data:image/')) {
      const m = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is.exec(url)
      if (!m) throw new Error('bad data URL')
      const bytes = m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!))
      return { bytes, ext: IMAGE_EXT[m[1]!.toLowerCase()] ?? '.img' }
    }
    if (!isHttpUrl(url)) throw new Error('unsupported')
    const res = await ses.fetch(url, { credentials: 'omit', headers: { Referer: referer }, signal } as RequestInit)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > 60 * 1024 * 1024) throw new Error('too large')
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > 60 * 1024 * 1024) throw new Error('too large')
    const ext = IMAGE_EXT[type] ?? (extname(new URL(url).pathname).toLowerCase() || '.img')
    return { bytes, ext }
  }

  // ------------------------------------------------------------------ actions

  action(id: string, action: 'pause' | 'resume' | 'cancel' | 'remove' | 'open' | 'show' | 'retry'): void {
    const rt = this.jobs.get(id)
    if (!rt) return
    const job = rt.job
    switch (action) {
      case 'pause':
        if (rt.kind === 'ytdlp' && rt.proc) {
          rt.stopping = 'pause'
          killTree(rt.proc.pid)
        } else if (rt.kind === 'electron' && rt.item && !rt.item.isPaused()) rt.item.pause()
        break
      case 'resume':
        if (rt.kind === 'ytdlp' && job.state === 'paused') {
          job.state = 'queued'
          job.stage = 'Queued'
          this.pump()
        } else if (rt.kind === 'electron' && rt.item?.canResume()) rt.item.resume()
        break
      case 'cancel':
        if (rt.kind === 'ytdlp') {
          if (rt.proc) {
            rt.stopping = 'cancel'
            killTree(rt.proc.pid)
          } else if (job.state === 'queued' || job.state === 'paused') this.finishCancelled(rt)
        } else if (rt.kind === 'electron') rt.item?.cancel()
        else if (rt.kind === 'images') {
          rt.stopping = 'cancel'
          rt.abort?.abort()
        }
        break
      case 'retry':
        if (rt.kind === 'ytdlp' && (job.state === 'error' || job.state === 'cancelled')) {
          job.state = 'queued'
          job.error = undefined
          job.progress = -1
          job.stage = 'Queued'
          job.finishedAt = undefined
          rt.files = []
          rt.streamsFinished = 0
          this.pump()
        }
        break
      case 'remove':
        if (['done', 'error', 'cancelled'].includes(job.state)) {
          this.jobs.delete(id)
          this.order = this.order.filter((x) => x !== id)
        }
        break
      case 'open':
        if (job.file && existsSync(job.file)) void shell.openPath(job.file)
        break
      case 'show':
        if (job.file && existsSync(job.file)) shell.showItemInFolder(job.file)
        else if (job.file && existsSync(dirname(job.file))) void shell.openPath(dirname(job.file))
        break
    }
    this.changed()
  }

  clearFinished(): void {
    for (const id of [...this.order]) {
      const rt = this.jobs.get(id)
      if (rt && ['done', 'error', 'cancelled'].includes(rt.job.state)) {
        this.jobs.delete(id)
        this.order = this.order.filter((x) => x !== id)
      }
    }
    this.changed()
  }

  /** Burn / quit: stop everything and forget the list (files already written stay on disk). */
  reset(): void {
    for (const rt of this.jobs.values()) {
      if (rt.proc) {
        rt.stopping = 'cancel'
        killTree(rt.proc.pid)
      }
      rt.item?.cancel()
      rt.abort?.abort()
      this.cleanupTmp(rt)
      // A quit may follow immediately and unref'd timers die with the process, so also try right now.
      if (rt.tmpDir) {
        try {
          rmSync(rt.tmpDir, { recursive: true, force: true })
        } catch {
          /* locked by a dying process: swept at the next start */
        }
      }
    }
    this.jobs.clear()
    this.order = []
    this.changed()
  }

  activeCount(): number {
    let n = 0
    for (const rt of this.jobs.values()) if (['queued', 'starting', 'downloading', 'processing'].includes(rt.job.state)) n++
    return n
  }

  // ------------------------------------------------------------------ yt-dlp self-update

  async updateYtdlp(tab?: Tab | null): Promise<{ ok: boolean; message: string }> {
    const bin = await ensureYtdlp()
    if (!bin) return { ok: false, message: 'yt-dlp is not installed.' }
    let proxy: string | null
    try {
      proxy = tab ? this.proxyFor(tab) : null
    } catch {
      proxy = null
    }
    const p = services.settings.get().proxy
    const rules = proxyRules(p)
    if (!proxy && rules) proxy = rules.replace(/^socks5:/, 'socks5h:')
    const args = ['--ignore-config', '--no-colors', ...(proxy ? ['--proxy', proxy] : []), '-U']
    const r = await runCapture(bin, args, { timeoutMs: 120_000, maxBytes: 200_000 })
    resetVersionCache()
    const text = `${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ')
    if (r.code === 0) {
      writeToolMeta({ ytdlpCheckedAt: Date.now() })
      return { ok: true, message: text || 'yt-dlp is up to date.' }
    }
    return { ok: false, message: (text || 'Update failed.').slice(0, 300) }
  }
}

export function statSafe(p: string): number {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}
