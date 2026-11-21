import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { createHash } from 'node:crypto'
import { siteOf } from '@shared/privacy'
import type { Settings } from '@shared/settings'
import { isolateScriptlet, LIST_CATALOG, listEnabled } from '@shared/shields'
import type {
  BlockedItem,
  BlockedNavigation,
  ListDef,
  ShieldsListsInfo,
  ShieldsPanelInfo
} from '@shared/shields'
import { registry } from '../app/registry'
import type { RequestPipeline } from '../net/RequestPipeline'
import { services } from '../services'
import type { Tab } from '../tabs/Tab'
import { ListStore } from './ListStore'
import type { Fetcher } from './ListStore'
import { PICKER_SCRIPT } from './picker-script'
import { ShieldsEngine } from './ShieldsEngine'
import { isYoutubeHost, YOUTUBE_CSS } from './youtube'

const COSMETIC_CHANNEL = '@ghostery/adblocker/inject-cosmetic-filters'
const MUTATION_CHANNEL = '@ghostery/adblocker/is-mutation-observer-enabled'
const UPDATE_CHECK_MS = 30 * 60 * 1000
/** Rough time saved per blocked request (connection + transfer), shown on the new-tab page. */
const SAVED_MS_PER_BLOCK = 60
const MAX_ITEMS = 200
const GESTURE_WINDOW_MS = 3000
const REDIRECT_GESTURE_WINDOW_MS = 4000

interface TabStats {
  ads: number
  trackers: number
  custom: number
  items: BlockedItem[]
  navigations: BlockedNavigation[]
  notifications: number
  popupTimes: number[]
}

const emptyStats = (): TabStats => ({ ads: 0, trackers: 0, custom: 0, items: [], navigations: [], notifications: 0, popupTimes: [] })

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

export class ShieldsManager {
  readonly store = new ListStore()
  readonly engine = new ShieldsEngine(this.store)
  private stats = new Map<number, TabStats>()
  private notifyTimers = new Map<number, NodeJS.Timeout>()
  private currentSignature = ''
  private queue: Promise<void> = Promise.resolve()
  private updating = false
  private timer: NodeJS.Timeout | null = null
  private pendingStatAdds = { ads: 0, trackers: 0 }
  private statTimer: NodeJS.Timeout | null = null
  private offline = process.env['BMAX_TEST'] === '1' && process.env['BMAX_SHIELDS_OFFLINE'] === '1'

  // ------------------------------------------------------------------ lifecycle

  init(): void {
    this.store.load()
    this.engine.setCustom(this.store.readCustom())
    ipcMain.handle(COSMETIC_CHANNEL, (event, url: string, msg?: { classes?: string[]; hrefs?: string[]; ids?: string[] }) =>
      this.onCosmetic(event, url, msg)
    )
    ipcMain.handle(MUTATION_CHANNEL, () => true)
    // Load the compiled engine shortly after startup (deserializing tens of MB must not delay the first window).
    // Then refresh anything older than 12 hours in the background (the cached engine keeps protecting meanwhile).
    setTimeout(() => {
      void this.schedule(async () => {
        this.loadCachedEngine()
        await this.reconfigure(true)
      })
    }, 1500).unref()
    this.timer = setInterval(() => this.schedule(() => this.reconfigure(true)), UPDATE_CHECK_MS)
    this.timer.unref()
  }

  private schedule(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn).catch((err) => console.warn('[shields]', err))
    return this.queue
  }

  private settings(): Settings['shields'] {
    return services.settings.get().shields
  }

  private enabledLists(): ListDef[] {
    const overrides = this.settings().lists
    return LIST_CATALOG.filter((l) => listEnabled(l, overrides))
  }

  private signature(lists: ListDef[]): string {
    const h = createHash('sha1')
    h.update('engine-v2')
    for (const l of lists) h.update(`${l.id}:${this.store.info(l.id)?.fetchedAt ?? 0};`)
    h.update(`res:${this.store.info('__resources')?.fetchedAt ?? 0}`)
    return h.digest('hex')
  }

  private fetcher(): Fetcher {
    return async (url, init) => {
      if (this.offline) throw new Error('offline (test)')
      return services.sessions.utility().fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' } as RequestInit)
    }
  }

  /**
   * Bring the engine in line with settings. `allowNetwork` = it is OK to refresh stale lists
   * (auto-update, or the user pressed "Update now").
   */
  private async reconfigure(checkStale: boolean, force = false): Promise<void> {
    if (!this.settings().enabled) return
    const lists = this.enabledLists()
    const wantNetwork = force || (this.settings().autoUpdate && !this.offline)
    let changed = false

    if (wantNetwork) {
      this.updating = true
      try {
        const fetcher = this.fetcher()
        const todo = lists.filter((l) => force || (checkStale ? this.store.isStale(l.id) : this.store.read(l.id) === null))
        const needResources = force || this.store.readResources() === null || (checkStale && this.store.isStale('__resources'))
        if (todo.length || needResources) {
          this.engine.setStatus({ state: this.engine.ads ? this.engine.status.state : 'loading', message: 'Downloading filter lists…' })
        }
        // Limited parallelism keeps memory and sockets sane.
        const queue = [...todo]
        const workers = Array.from({ length: 4 }, async () => {
          for (let l = queue.shift(); l; l = queue.shift()) {
            if ((await this.store.refresh(l, fetcher)) === 'updated') changed = true
          }
        })
        await Promise.all(workers)
        if (needResources && (await this.store.refreshResources(fetcher)) === 'updated') changed = true
      } finally {
        this.updating = false
      }
    }

    const sig = this.signature(lists)
    if (sig === this.currentSignature && !changed && this.engine.ads) return
    if (!changed && !this.engine.ads && this.engine.loadCache(sig)) {
      this.currentSignature = sig
      this.engine.syncCustomResources()
      return
    }

    const texts = { ads: [] as string[], trackers: [] as string[] }
    let have = 0
    for (const l of lists) {
      const text = this.store.read(l.id)
      if (text === null) continue
      have++
      for (const g of l.groups) texts[g].push(text)
    }
    if (have === 0) {
      this.engine.setStatus({
        state: this.offline || !wantNetwork ? 'offline' : 'error',
        message: wantNetwork ? 'No filter lists could be downloaded yet.' : 'No filter lists downloaded. Press "Update now" in Settings → Shields.'
      })
      return
    }
    const ok = await this.engine.build(sig, { ads: texts.ads.join('\n'), trackers: texts.trackers.join('\n'), resources: this.store.readResources() })
    if (ok) {
      this.currentSignature = sig
      this.engine.syncCustomResources()
    }
  }

  /** Use the compiled engine from disk right away if it matches the enabled lists. */
  private loadCachedEngine(): void {
    if (!this.settings().enabled || this.engine.ads) return
    const sig = this.signature(this.enabledLists())
    if (this.engine.loadCache(sig)) {
      this.currentSignature = sig
      this.engine.syncCustomResources()
    }
  }

  /** Settings → Shields "Update now". */
  refresh(): Promise<void> {
    return this.schedule(() => this.reconfigure(false, true))
  }

  onSettingsChange(prev: Settings, next: Settings): void {
    const a = prev.shields
    const b = next.shields
    if (JSON.stringify(a.lists) !== JSON.stringify(b.lists) || (!a.enabled && b.enabled)) {
      void this.schedule(() => this.reconfigure(false))
    }
    if (a.disabledSites.join() !== b.disabledSites.join() || a.enabled !== b.enabled) {
      for (const w of services.windows.all()) w.notify()
    }
  }

  // ------------------------------------------------------------------ request blocking

  siteEnabled(pageUrl: string): boolean {
    const s = this.settings()
    if (!s.enabled) return false
    const host = hostOf(pageUrl)
    if (!host) return true
    return !s.disabledSites.includes(siteOf(host))
  }

  registerPipeline(pipeline: RequestPipeline): void {
    pipeline.onBeforeRequest('shields', (d) => {
      if (d.resourceType === 'mainFrame' || !this.settings().enabled || !this.engine.hasAny()) return
      if (!/^(https?|wss?):/i.test(d.url)) return
      const wc = d.webContents
      if (!wc || wc.isDestroyed()) return
      const top = wc.getURL()
      if (!isWeb(top) || !this.siteEnabled(top)) return
      const out = this.engine.match({ url: d.url, sourceUrl: top, resourceType: d.resourceType, tabId: wc.id, requestId: String(d.id) })
      if (out.action === 'allow') return
      this.record(wc.id, { host: hostOf(d.url) || d.url, type: d.resourceType, category: out.category, redirected: out.action === 'redirect' })
      return out.action === 'block' ? { cancel: true } : { redirectURL: out.url }
    })

    pipeline.onHeadersReceived('shields-csp', (d, headers) => {
      if (d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame') return
      if (!this.settings().enabled || !this.engine.hasAny()) return
      const wc = d.webContents
      const top = d.resourceType === 'mainFrame' ? d.url : (wc?.getURL() ?? '')
      if (!isWeb(top) || !this.siteEnabled(top)) return
      const csp = this.engine.csp({ url: d.url, sourceUrl: top, resourceType: d.resourceType, tabId: wc?.id ?? 0, requestId: String(d.id) })
      if (!csp) return
      const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy') ?? 'content-security-policy'
      headers[key] = [...(headers[key] ?? []), csp]
    })
  }

  // ------------------------------------------------------------------ per-tab statistics

  private statsFor(wcId: number): TabStats {
    let s = this.stats.get(wcId)
    if (!s) {
      s = emptyStats()
      this.stats.set(wcId, s)
    }
    return s
  }

  /** New page in this tab: counters restart. */
  resetTab(wcId: number): void {
    this.stats.set(wcId, emptyStats())
    this.notifyTab(wcId)
  }

  forgetTab(wcId: number): void {
    this.stats.delete(wcId)
    const t = this.notifyTimers.get(wcId)
    if (t) clearTimeout(t)
    this.notifyTimers.delete(wcId)
  }

  private record(wcId: number, item: BlockedItem): void {
    const s = this.statsFor(wcId)
    if (item.category === 'ad') s.ads++
    else if (item.category === 'tracker') s.trackers++
    else s.custom++
    s.items.push(item)
    if (s.items.length > MAX_ITEMS) s.items.shift()
    if (item.category === 'tracker') this.pendingStatAdds.trackers++
    else this.pendingStatAdds.ads++
    this.scheduleStatFlush()
    this.notifyTab(wcId)
  }

  private scheduleStatFlush(): void {
    if (this.statTimer) return
    this.statTimer = setTimeout(() => {
      this.statTimer = null
      const { ads, trackers } = this.pendingStatAdds
      this.pendingStatAdds = { ads: 0, trackers: 0 }
      services.stats.add({ adsBlocked: ads, trackersBlocked: trackers, timeSavedMs: (ads + trackers) * SAVED_MS_PER_BLOCK })
    }, 2000)
    this.statTimer.unref()
  }

  private notifyTab(wcId: number): void {
    if (this.notifyTimers.has(wcId)) return
    this.notifyTimers.set(
      wcId,
      setTimeout(() => {
        this.notifyTimers.delete(wcId)
        const info = registry.get(wcId)
        if (info?.role === 'tab' && !info.tab.isDestroyed) info.tab.window.notify()
      }, 150)
    )
  }

  tabSummary(wcId: number, pageUrl: string): { enabled: boolean; blocked: number } {
    const s = this.stats.get(wcId)
    return { enabled: this.siteEnabled(pageUrl), blocked: s ? s.ads + s.trackers + s.custom : 0 }
  }

  // ------------------------------------------------------------------ popups, redirects, notifications

  private guard(tab: Tab): boolean {
    const s = this.settings()
    return s.enabled && this.siteEnabled(tab.url)
  }

  /** window.open / target=_blank handling: pop-ups need a recent user gesture and are rate-limited. */
  shouldBlockPopup(tab: Tab, features: string, targetUrl: string): boolean {
    if (!this.settings().blockPopups || !this.guard(tab)) return false
    const s = this.statsFor(tab.wc.id)
    const now = Date.now()
    const gesture = now - tab.lastGestureAt < GESTURE_WINDOW_MS
    s.popupTimes = s.popupTimes.filter((t) => now - t < 10_000)
    const tooMany = s.popupTimes.length >= 3
    const isPopupWindow = features.trim() !== ''
    const block = !gesture || tooMany || (isPopupWindow && now - tab.pageLoadedAt < 400)
    if (block) {
      this.addNavigation(tab, { kind: 'popup', url: targetUrl })
    } else {
      s.popupTimes.push(now)
    }
    return block
  }

  /** Cross-site top-level navigations started by a script without a user gesture ("auto-redirects", pop-under tricks). */
  shouldBlockRedirect(tab: Tab, targetUrl: string): boolean {
    if (!this.settings().blockRedirects || !this.guard(tab)) return false
    if (!isWeb(tab.url) || !isWeb(targetUrl)) return false
    if (Date.now() - tab.lastGestureAt < REDIRECT_GESTURE_WINDOW_MS) return false
    let sameSite: boolean
    try {
      sameSite = siteOf(new URL(tab.url).hostname) === siteOf(new URL(targetUrl).hostname)
    } catch {
      sameSite = true
    }
    if (sameSite) return false
    this.addNavigation(tab, { kind: 'redirect', url: targetUrl })
    return true
  }

  /** Notification permission prompts are blocked by default (push-notification spam). */
  shouldBlockNotificationPrompt(tab: Tab): boolean {
    if (!this.settings().blockNotifications || !this.guard(tab)) return false
    this.statsFor(tab.wc.id).notifications++
    this.notifyTab(tab.wc.id)
    return true
  }

  private addNavigation(tab: Tab, nav: BlockedNavigation): void {
    const s = this.statsFor(tab.wc.id)
    s.navigations.push(nav)
    if (s.navigations.length > 20) s.navigations.shift()
    this.notifyTab(tab.wc.id)
  }

  allowNavigation(tab: Tab, url: string): void {
    if (!isWeb(url)) return
    tab.loadUrl(url)
  }

  // ------------------------------------------------------------------ cosmetic filtering + scriptlets

  private onCosmetic(event: IpcMainInvokeEvent, url: string, msg?: { classes?: string[]; hrefs?: string[]; ids?: string[] }): void {
    const info = registry.get(event.sender.id)
    if (info?.role !== 'tab' || typeof url !== 'string' || !isWeb(url)) return
    if (!this.settings().enabled || !this.engine.hasAny()) return
    if (!this.siteEnabled(event.sender.getURL() || url)) return
    let hostname: string
    try {
      hostname = new URL(url).hostname
    } catch {
      return
    }
    const r = this.engine.cosmetics(url, hostname, siteOf(hostname), msg, { frameId: event.frameId, processId: event.processId })
    if (this.settings().youtube && isYoutubeHost(hostname)) r.styles = `${r.styles}\n${YOUTUBE_CSS}`
    const frame = event.senderFrame
    if (r.styles && frame && frame === event.sender.mainFrame) {
      void event.sender.insertCSS(r.styles, { cssOrigin: 'user' }).catch(() => undefined)
    }
    for (const script of r.scripts) {
      void frame?.executeJavaScript(isolateScriptlet(script), true).catch(() => undefined)
    }
  }

  // ------------------------------------------------------------------ panel, picker, rules

  panelInfo(tab: Tab | null): ShieldsPanelInfo {
    const s = tab ? this.stats.get(tab.wc.id) : undefined
    const url = tab?.url ?? ''
    const site = isWeb(url) ? hostOf(url) : ''
    return {
      tabId: tab?.id ?? null,
      site,
      supported: isWeb(url),
      globalEnabled: this.settings().enabled,
      siteEnabled: isWeb(url) ? this.siteEnabled(url) : false,
      blocked: s ? s.ads + s.trackers + s.custom : 0,
      ads: s?.ads ?? 0,
      trackers: s?.trackers ?? 0,
      customHidden: s?.custom ?? 0,
      items: s ? [...s.items].reverse().slice(0, 100) : [],
      navigations: s ? [...s.navigations].reverse() : [],
      notificationsBlocked: s?.notifications ?? 0,
      lifetime: services.stats.get(),
      engine: this.engine.status
    }
  }

  setSite(tab: Tab, enabled: boolean): void {
    if (!isWeb(tab.url)) return
    const site = siteOf(hostOf(tab.url))
    const cur = this.settings().disabledSites
    const next = enabled ? cur.filter((s) => s !== site) : cur.includes(site) ? cur : [...cur, site]
    services.settings.update({ shields: { ...this.settings(), disabledSites: next } })
    tab.reload(true)
  }

  /** Run the element picker in a tab and persist the result as a cosmetic rule. */
  async pick(tab: Tab): Promise<string | null> {
    if (!isWeb(tab.url)) return null
    const selector: unknown = await tab.wc.executeJavaScript(PICKER_SCRIPT, true).catch(() => null)
    if (typeof selector !== 'string' || selector.length === 0 || selector.length > 500) return null
    const host = hostOf(tab.url)
    const rule = `${host}##${selector}`
    const text = this.store.readCustom()
    const next = text.includes(rule) ? text : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${rule}\n`
    this.store.writeCustom(next)
    this.engine.setCustom(next)
    void tab.wc.insertCSS(`${selector}{display:none!important}`, { cssOrigin: 'user' }).catch(() => undefined)
    return rule
  }

  getRules(): string {
    return this.store.readCustom()
  }

  setRules(text: string): { ok: boolean; lines: number; error?: string } {
    if (text.length > 200_000) return { ok: false, lines: 0, error: 'Too large' }
    try {
      const lines = this.engine.setCustom(text)
      this.store.writeCustom(text)
      return { ok: true, lines }
    } catch (err) {
      return { ok: false, lines: 0, error: err instanceof Error ? err.message : 'Invalid rules' }
    }
  }

  listsInfo(): ShieldsListsInfo {
    const overrides = this.settings().lists
    return {
      lists: LIST_CATALOG.map((l) => ({
        id: l.id,
        name: l.name,
        category: l.category,
        enabled: listEnabled(l, overrides),
        note: l.note,
        fetchedAt: this.store.info(l.id)?.fetchedAt ?? 0,
        bytes: this.store.info(l.id)?.bytes ?? 0
      })),
      engine: this.engine.status,
      updating: this.updating
    }
  }

}
