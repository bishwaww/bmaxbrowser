import type { ImageCandidate, MediaPanelInfo, MediaSummary, SniffedMedia } from '@shared/downloads'
import { IMAGE_THRESHOLDS } from '@shared/downloads'
import type { ImageSummary } from '@shared/downloads'
import { registry } from '../app/registry'
import type { RequestPipeline } from '../net/RequestPipeline'
import { services } from '../services'
import type { Tab } from '../tabs/Tab'
import { classifyMedia } from './args'
import { toolPresence } from './tools'

const MAX_SNIFFED = 40

const COUNT_SCRIPT = `(() => {
  const imgs = new Set()
  for (const i of document.images) if (i.naturalWidth >= 100 && i.naturalHeight >= 100) imgs.add(i.currentSrc || i.src)
  return { videos: document.querySelectorAll('video').length, audios: document.querySelectorAll('audio').length, images: imgs.size }
})()`

const IMAGES_SCRIPT = `(() => {
  const seen = new Set()
  const out = []
  for (const i of document.images) {
    const url = i.currentSrc || i.src
    if (!url || seen.has(url) || !/^(https?:|data:image\\/)/i.test(url)) continue
    seen.add(url)
    out.push({ url, width: i.naturalWidth || 0, height: i.naturalHeight || 0 })
  }
  return out.slice(0, 2000)
})()`

const isWeb = (u: string): boolean => /^https?:\/\//i.test(u)

/** Finds downloadable media on the current page: DOM media/images, plus media files and manifests seen on the network. */
export class MediaTracker {
  private sniffed = new Map<number, Map<string, SniffedMedia>>()
  private counts = new Map<number, { videos: number; audios: number; images: number }>()
  private scanTimers = new Map<number, NodeJS.Timeout>()

  registerPipeline(pipeline: RequestPipeline): void {
    pipeline.onHeadersReceived('media-sniffer', (d, headers) => {
      if (d.statusCode !== 200 && d.statusCode !== 206) return
      const wc = d.webContents
      if (!wc || wc.isDestroyed() || !isWeb(wc.getURL() || d.url)) return
      const get = (name: string): string => headers[Object.keys(headers).find((k) => k.toLowerCase() === name) ?? '']?.[0] ?? ''
      const mime = get('content-type')
      let size: number | null = null
      const range = /\/(\d+)$/.exec(get('content-range'))
      if (range) size = Number(range[1])
      else if (get('content-length')) size = Number(get('content-length'))
      const kind = classifyMedia(d.url, mime, Number.isFinite(size) ? size : null)
      if (!kind) return
      let m = this.sniffed.get(wc.id)
      if (!m) {
        m = new Map()
        this.sniffed.set(wc.id, m)
      }
      if (m.has(d.url) || m.size >= MAX_SNIFFED) return
      m.set(d.url, { url: d.url, kind, mime: mime.split(';')[0] ?? '', size: Number.isFinite(size) ? size : null })
      this.notify(wc.id)
    })
  }

  /** New page in a tab: forget what the previous one had. */
  resetTab(wcId: number): void {
    this.sniffed.delete(wcId)
    this.counts.delete(wcId)
    this.notify(wcId)
  }

  forgetTab(wcId: number): void {
    this.sniffed.delete(wcId)
    this.counts.delete(wcId)
    const t = this.scanTimers.get(wcId)
    if (t) clearTimeout(t)
    this.scanTimers.delete(wcId)
  }

  /** Look at the DOM shortly after a load / in-page navigation (debounced). */
  scheduleScan(tab: Tab, delayMs = 1200, retriesLeft = 2): void {
    const id = tab.wc.id
    const old = this.scanTimers.get(id)
    if (old) clearTimeout(old)
    this.scanTimers.set(
      id,
      setTimeout(() => {
        this.scanTimers.delete(id)
        if (tab.isDestroyed || !isWeb(tab.wc.getURL())) return
        void tab.wc
          .executeJavaScript(COUNT_SCRIPT, false)
          .then((r: { videos: number; audios: number; images: number }) => {
            this.counts.set(id, { videos: r.videos | 0, audios: r.audios | 0, images: r.images | 0 })
            this.notify(id)
            // Players are often created well after the page loads (YouTube and other single-page apps): look again a little later.
            if ((r.videos | 0) + (r.audios | 0) === 0 && retriesLeft > 0) this.scheduleScan(tab, 4000, retriesLeft - 1)
          })
          .catch(() => undefined)
      }, delayMs)
    )
  }

  private notify(wcId: number): void {
    const info = registry.get(wcId)
    if (info?.role === 'tab' && !info.tab.isDestroyed) info.tab.window.notify()
  }

  summary(wcId: number): MediaSummary {
    const c = this.counts.get(wcId)
    return { videos: c?.videos ?? 0, audios: c?.audios ?? 0, images: c?.images ?? 0, sniffed: this.sniffed.get(wcId)?.size ?? 0 }
  }

  sniffedList(wcId: number): SniffedMedia[] {
    return [...(this.sniffed.get(wcId)?.values() ?? [])]
  }

  async collectImages(tab: Tab): Promise<ImageCandidate[]> {
    if (!isWeb(tab.url)) return []
    const r: unknown = await tab.wc.executeJavaScript(IMAGES_SCRIPT, false).catch(() => [])
    return Array.isArray(r) ? (r as ImageCandidate[]) : []
  }

  async imageSummary(tab: Tab): Promise<ImageSummary> {
    const imgs = await this.collectImages(tab)
    const byMinWidth: Record<string, number> = {}
    for (const t of IMAGE_THRESHOLDS) byMinWidth[String(t)] = imgs.filter((i) => i.width >= t).length
    return { total: imgs.length, byMinWidth }
  }

  async panelInfo(tab: Tab | null): Promise<MediaPanelInfo> {
    const url = tab?.url ?? ''
    const { ytdlp, ffmpeg } = toolPresence()
    return {
      tabId: tab?.id ?? null,
      url,
      title: tab?.title ?? '',
      supported: isWeb(url),
      viaTor: tab?.window.tor ?? false,
      torReady: services.tor.isReady(),
      summary: tab ? this.summary(tab.wc.id) : { videos: 0, audios: 0, images: 0, sniffed: 0 },
      sniffed: tab ? this.sniffedList(tab.wc.id) : [],
      ytdlp,
      ffmpeg
    }
  }
}
