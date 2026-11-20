import { nativeTheme, WebContentsView } from 'electron'
import type { Session, WebContents, WebFrameMain } from 'electron'
import { internalUrl, isInternalUrl, parseInternalUrl } from '@shared/internal'
import type { CertInfo, SecurityLevel, TabInfo } from '@shared/types'
import { matchShortcut } from '@shared/shortcuts'
import { confirmAndOpenExternal, isBrowserHandledUrl } from '../app/external'
import { internalPageOf, isTrustedInternalUrl, resolveLoadUrl, toLogicalUrl } from '../app/internal-pages'
import { registry } from '../app/registry'
import { upgradedNavigations } from '../net/privacy-handlers'
import { services } from '../services'
import type { BmaxWindow } from '../windows/BmaxWindow'
import { buildContextMenu } from './contextMenu'
import { fetchFavicon } from './favicon'
import { nextZoom } from './zoom'

let seq = 0

/**
 * What a sleeping tab remembers. The page is replaced by about:blank, which becomes the newest history entry; waking steps back
 * to the entry the tab was on (so back/forward history and scroll position survive) and removes the placeholder.
 * `history: false` is a tab created asleep (session restore): it has no history yet and simply loads its address.
 */
interface SleepState {
  history: boolean
  index: number
  url: string
  title: string
}

/** Script run in a frame to open/close picture-in-picture for the best video on the page. */
const PIP_SCRIPT = `(async () => {
  if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'closed' }
  const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 && v.videoWidth > 0 && !v.disablePictureInPicture)
  if (!vids.length) return 'none'
  const area = (v) => v.clientWidth * v.clientHeight
  vids.sort((a, b) => Number(!a.paused) - Number(!b.paused) || area(b) - area(a))
  await vids[0].requestPictureInPicture()
  return 'opened'
})()`

export class Tab {
  readonly id = ++seq
  readonly view: WebContentsView
  readonly partition: string
  window: BmaxWindow
  pinned = false
  muted = false
  audible = false
  loading = false
  progress = 0
  favicon: string | null = null
  private pendingUrl: string | null = null
  /** Timestamp of the last real user input in this tab (used to tell user-initiated pop-ups/redirects from scripted ones). */
  lastGestureAt = 0
  pageLoadedAt = 0
  /** Last time this tab was the visible tab of its window (drives tab sleeping). */
  lastActiveAt = Date.now()
  sleeping = false
  private sleepState: SleepState | null = null
  private cdpAttached = false
  private lastFaviconUrl = ''
  private destroyed = false

  /** `lazy`: create the tab asleep (nothing loads until it is first selected) - used by session restore. */
  constructor(window: BmaxWindow, partition: string, url?: string, opts: { lazy?: boolean } = {}) {
    this.window = window
    this.partition = partition
    const ses: Session = services.sessions.web(partition, { tor: window.tor })
    this.view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        safeDialogs: true,
        navigateOnDragDrop: false
      }
    })
    this.view.setBackgroundColor('#ffffff')
    registry.register(this.wc, { role: 'tab', tab: this })
    services.sessions.retain(partition)
    // No ICE candidates over direct UDP: a WebRTC page can never learn or leak the real IP address.
    this.wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    this.bind()
    const target = url ?? services.settings.get().homepage
    if (opts.lazy) {
      this.sleeping = true
      this.sleepState = { history: false, index: 0, url: target, title: '' }
    } else this.loadUrl(target)
    void this.applyColorScheme()
  }

  get wc(): WebContents {
    return this.view.webContents
  }

  get session(): Session {
    return this.wc.session
  }

  get isDestroyed(): boolean {
    return this.destroyed || this.wc.isDestroyed()
  }

  // ---------------------------------------------------------------- navigation

  loadUrl(url: string): void {
    this.sleeping = false
    this.sleepState = null
    this.pendingUrl = toLogicalUrl(url)
    this.window.notify()
    this.wc.loadURL(resolveLoadUrl(url)).catch(() => {
      /* did-fail-load shows the error page; ERR_ABORTED (superseded navigations) is expected */
    })
  }

  back(): void {
    if (this.wc.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack()
  }
  forward(): void {
    if (this.wc.navigationHistory.canGoForward()) this.wc.navigationHistory.goForward()
  }
  reload(hard = false): void {
    if (this.sleeping) {
      this.wake()
      return
    }
    if (hard) this.wc.reloadIgnoringCache()
    else this.wc.reload()
  }
  stop(): void {
    this.wc.stop()
  }

  // ---------------------------------------------------------------- state

  /** URL shown in the address bar (the failed URL on the error page, the typed URL while loading). */
  get url(): string {
    if (this.sleepState) return this.sleepState.url
    const current = toLogicalUrl(this.wc.getURL())
    const parsed = parseInternalUrl(current)
    if (parsed?.page === 'error' || parsed?.page === 'warning' || parsed?.page === 'reader') {
      const failed = new URLSearchParams(parsed.search).get('url')
      if (failed) return failed
    }
    if (this.pendingUrl && (this.loading || !current)) return this.pendingUrl
    return current
  }

  get title(): string {
    if (this.sleepState) {
      if (this.sleepState.title) return this.sleepState.title
      try {
        return new URL(this.sleepState.url).host || 'New Tab'
      } catch {
        return 'New Tab'
      }
    }
    const url = this.url
    const parsed = parseInternalUrl(toLogicalUrl(this.wc.getURL()))
    if (parsed?.page === 'newtab') return 'New Tab'
    if (parsed?.page === 'settings') return 'Settings'
    if (parsed?.page === 'error') return "Can't reach this page"
    if (parsed?.page === 'warning') return 'Connection not secure'
    if (parsed?.page === 'tor') return 'Connecting to Tor'
    if (parsed?.page === 'bookmarks') return 'Bookmarks'
    if (parsed?.page === 'privacy') return 'Privacy policy'
    const t = this.wc.getTitle()
    if (t) return t
    try {
      return new URL(url).host || url || 'New Tab'
    } catch {
      return url || 'New Tab'
    }
  }

  get security(): SecurityLevel {
    const url = this.url
    if (isInternalUrl(url) || parseInternalUrl(toLogicalUrl(this.wc.getURL()))) return 'internal'
    try {
      const u = new URL(url)
      if (u.protocol === 'https:') {
        const ok = services.certs.isOk(u.hostname)
        return ok === false ? 'error' : 'secure'
      }
      if (u.protocol === 'http:') return 'insecure'
      if (u.protocol === 'file:') return 'file'
    } catch {
      /* fallthrough */
    }
    return 'none'
  }

  certInfo(): CertInfo | null {
    try {
      const u = new URL(this.url)
      return u.protocol === 'https:' ? services.certs.info(u.hostname) : null
    } catch {
      return null
    }
  }

  info(): TabInfo {
    const url = this.url
    return {
      id: this.id,
      title: this.title,
      url,
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: this.wc.navigationHistory.canGoBack(),
      canGoForward: this.wc.navigationHistory.canGoForward(),
      pinned: this.pinned,
      muted: this.muted,
      audible: this.audible,
      security: this.security,
      isNewTab: internalPageOf(this.wc.getURL()) === 'newtab',
      sleeping: this.sleeping,
      container: services.sessions.containerLabel(this.partition),
      bookmarked: services.bookmarks.has(url),
      shields: services.shields.tabSummary(this.wc.id, url),
      media: services.media.summary(this.wc.id)
    }
  }

  // ---------------------------------------------------------------- zoom

  private hostKey(): string | null {
    try {
      const u = new URL(this.url)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : null
    } catch {
      return null
    }
  }

  get zoomFactor(): number {
    return this.wc.getZoomFactor()
  }

  applyStoredZoom(): void {
    const host = this.hostKey()
    this.wc.setZoomFactor(host ? services.windows.zoom.get(this.partition, host) : 1)
    this.window.notify()
  }

  zoom(op: 'in' | 'out' | 'reset'): void {
    const host = this.hostKey()
    const next = op === 'reset' ? 1 : nextZoom(this.wc.getZoomFactor(), op)
    this.wc.setZoomFactor(next)
    if (host) services.windows.zoom.set(this.partition, host, next)
    this.window.notify()
  }

  // ---------------------------------------------------------------- audio / pin

  setMuted(muted: boolean): void {
    this.muted = muted
    this.wc.setAudioMuted(muted)
    this.window.notify()
  }

  // ---------------------------------------------------------------- events

  private bind(): void {
    const wc = this.wc
    const notify = (): void => this.window.notify()

    wc.on('page-title-updated', notify)
    wc.on('page-favicon-updated', (_e, favicons) => {
      const url = favicons[0]
      if (!url || url === this.lastFaviconUrl) return
      this.lastFaviconUrl = url
      void fetchFavicon(this.session, url).then((data) => {
        if (this.isDestroyed || this.lastFaviconUrl !== url) return
        this.favicon = data
        notify()
      })
    })
    wc.on('did-start-loading', () => {
      this.loading = true
      this.progress = 0.1
      notify()
    })
    wc.on('dom-ready', () => {
      this.progress = Math.max(this.progress, 0.6)
      void this.applyColorScheme()
      notify()
    })
    wc.on('did-stop-loading', () => {
      this.loading = false
      this.progress = 0
      this.pendingUrl = null
      notify()
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        services.shields.resetTab(wc.id)
        services.media.resetTab(wc.id)
        services.permissions.cancelForWebContents(wc.id)
        this.window.overlays.hideTransient()
        this.window.overlays.hide('find')
      }
    })
    wc.on('did-navigate', () => {
      this.pageLoadedAt = Date.now()
      upgradedNavigations.delete(wc.id)
      this.pendingUrl = null
      if (!this.sleeping) {
        this.lastFaviconUrl = ''
        this.favicon = null
      }
      this.applyStoredZoom()
      notify()
    })
    wc.on('did-navigate-in-page', () => {
      services.media.scheduleScan(this)
      notify()
    })
    wc.on('did-finish-load', () => services.media.scheduleScan(this))
    // A video or audio element started playing: the page certainly has media now.
    wc.on('media-started-playing', () => services.media.scheduleScan(this, 300, 0))
    wc.on('did-fail-load', (_e, code, desc, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 || isInternalUrl(toLogicalUrl(validatedUrl))) return
      this.loading = false
      const up = upgradedNavigations.get(wc.id)
      if (up) {
        upgradedNavigations.delete(wc.id)
        // The HTTPS-Only upgrade failed: ask before falling back to plain HTTP.
        if (validatedUrl === up.to || new URL(validatedUrl).host === new URL(up.to).host) {
          const w = new URLSearchParams({ url: up.from, code: String(code) })
          this.wc.loadURL(resolveLoadUrl(internalUrl('warning', `?${w.toString()}`))).catch(() => undefined)
          return
        }
      }
      const q = new URLSearchParams({ code: String(code), desc, url: validatedUrl })
      this.wc.loadURL(resolveLoadUrl(internalUrl('error', `?${q.toString()}`))).catch(() => undefined)
    })
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      const q = new URLSearchParams({ code: 'crashed', desc: details.reason, url: this.url })
      this.wc.loadURL(resolveLoadUrl(internalUrl('error', `?${q.toString()}`))).catch(() => undefined)
    })
    wc.on('audio-state-changed', (e) => {
      this.audible = e.audible
      notify()
    })
    wc.on('focus', () => this.window.overlays.hideTransient())
    wc.on('input-event', (_e, input) => {
      const t = input.type
      if (t === 'mouseDown' || t === 'mouseUp' || t === 'rawKeyDown' || t === 'keyDown' || t === 'touchStart' || t === 'touchEnd') this.lastGestureAt = Date.now()
    })
    wc.on('zoom-changed', (_e, dir) => this.zoom(dir))
    wc.on('found-in-page', (_e, result) => this.window.onFound(this, result.activeMatchOrdinal, result.matches))
    wc.on('enter-html-full-screen', () => this.window.setHtmlFullscreen(true))
    wc.on('leave-html-full-screen', () => this.window.setHtmlFullscreen(false))
    wc.on('context-menu', (_e, params) => buildContextMenu(this, params).popup({ window: this.window.base }))

    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const cmd = matchShortcut(input, process.platform)
      if (cmd) {
        event.preventDefault()
        this.window.execute(cmd)
      }
    })

    // All frame navigations pass through here (programmatic loadURL does not).
    wc.on('will-frame-navigate', (event) => {
      const target = event.url
      const fromInternal = isTrustedInternalUrl(wc.getURL())
      if (/^magnet:/i.test(target)) {
        // magnet links open the built-in torrent manager, but only right after a user gesture (no scripted spam).
        event.preventDefault()
        if (event.isMainFrame && Date.now() - this.lastGestureAt < 3000) void services.torrents.handleMagnet(target, this)
        return
      }
      if (this.sameExtensionOrigin(target)) return
      if (!isBrowserHandledUrl(target)) {
        event.preventDefault()
        if (event.isMainFrame) void confirmAndOpenExternal(target, this.window.base)
        return
      }
      const toInternal = isTrustedInternalUrl(target)
      // Web pages may not navigate to (or frame) internal pages; internal pages may not navigate away by themselves.
      if ((toInternal && (!fromInternal || !event.isMainFrame)) || (fromInternal && !toInternal)) {
        event.preventDefault()
        return
      }
      // Scripted cross-site top-level navigation without a user gesture (auto-redirect / pop-under trick).
      if (event.isMainFrame && !event.isSameDocument && !fromInternal && services.shields.shouldBlockRedirect(this, target)) {
        event.preventDefault()
      }
    })

    wc.setWindowOpenHandler((details) => {
      const target = details.url
      if (isTrustedInternalUrl(wc.getURL())) return { action: 'deny' }
      if (/^magnet:/i.test(target)) {
        if (Date.now() - this.lastGestureAt < 3000) void services.torrents.handleMagnet(target, this)
        return { action: 'deny' }
      }
      if (!isBrowserHandledUrl(target)) {
        void confirmAndOpenExternal(target, this.window.base)
        return { action: 'deny' }
      }
      if (isTrustedInternalUrl(target)) return { action: 'deny' }
      if (services.shields.shouldBlockPopup(this, details.features, target)) return { action: 'deny' }
      this.window.openTab(target, { background: details.disposition === 'background-tab', partition: this.partition })
      return { action: 'deny' }
    })
  }

  // ---------------------------------------------------------------- tab sleeping

  /** A background tab that may be unloaded: nothing playing, loading or open in DevTools, and not an internal page. */
  canSleep(): boolean {
    if (this.isDestroyed || this.sleeping || this.window.activeTab === this) return false
    if (this.audible || this.loading || this.wc.isDevToolsOpened()) return false
    return /^(https?|file):/i.test(this.url)
  }

  /** Whether any frame is showing picture-in-picture (such a tab must keep running). */
  async hasPictureInPicture(): Promise<boolean> {
    for (const f of this.wc.mainFrame.framesInSubtree) {
      try {
        if (await f.executeJavaScript('!!document.pictureInPictureElement')) return true
      } catch {
        /* frame went away */
      }
    }
    return false
  }

  /** Free the page's memory but keep the tab (and its history) so it reloads when selected. */
  sleep(): boolean {
    if (!this.canSleep()) return false
    const nav = this.wc.navigationHistory
    this.sleepState = { history: true, index: nav.getActiveIndex(), url: this.url, title: this.title }
    this.sleeping = true
    this.pendingUrl = null
    services.shields.resetTab(this.wc.id)
    services.media.resetTab(this.wc.id)
    this.wc.loadURL('about:blank').catch(() => undefined)
    this.window.notify()
    return true
  }

  wake(): void {
    const s = this.sleepState
    if (!this.sleeping || !s) return
    this.sleeping = false
    this.sleepState = null
    this.lastActiveAt = Date.now()
    this.window.notify()
    if (!s.history) {
      this.loadUrl(s.url)
      return
    }
    // (navigationHistory.restore() refuses webContents that have already loaded a page, so step back through the history instead.)
    const nav = this.wc.navigationHistory
    if (s.index >= nav.length() - 1) {
      this.loadUrl(s.url)
      return
    }
    this.wc.once('did-navigate', () => {
      if (this.isDestroyed) return
      try {
        for (let i = nav.length() - 1; i > nav.getActiveIndex(); i--) if (nav.getEntryAtIndex(i)?.url === 'about:blank') nav.removeEntryAtIndex(i)
      } catch {
        /* the placeholder entry may stay; harmless */
      }
    })
    this.pendingUrl = s.url
    nav.goToIndex(s.index)
  }

  // ---------------------------------------------------------------- site colour scheme (prefers-color-scheme)

  /** prefers-color-scheme reported to the page: follows the app theme unless the user forced one; Tor windows always say light. */
  private emulatedScheme(): 'light' | 'dark' {
    if (this.window.tor) return 'light'
    const pref = services.settings.get().siteColorScheme
    if (pref === 'follow') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    return pref
  }

  async applyColorScheme(): Promise<void> {
    if (this.isDestroyed) return
    try {
      if (!this.cdpAttached) {
        this.wc.debugger.attach('1.3')
        this.cdpAttached = true
      }
      await this.wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: this.emulatedScheme() }] })
    } catch {
      /* debugger unavailable (e.g. another client): sites simply keep the default scheme */
    }
  }

  // ---------------------------------------------------------------- picture-in-picture

  /** Toggle picture-in-picture for the best video in the page (or in the given frame). Resolves to what happened. */
  async togglePictureInPicture(frame?: WebFrameMain): Promise<'opened' | 'closed' | 'none' | 'error'> {
    const frames = frame ? [frame] : [...this.wc.mainFrame.framesInSubtree]
    let result: 'opened' | 'closed' | 'none' | 'error' = 'none'
    for (const f of frames) {
      try {
        // userGesture=true: requestPictureInPicture needs user activation (this call IS the user's action).
        const r = (await f.executeJavaScript(PIP_SCRIPT, true)) as string
        if (r === 'opened' || r === 'closed') return r
      } catch {
        result = 'error'
      }
    }
    return result
  }

  /** An extension page may navigate within its own extension (popup/options pages link to each other). */
  private sameExtensionOrigin(target: string): boolean {
    try {
      const here = new URL(this.wc.getURL())
      const there = new URL(target)
      return here.protocol === 'chrome-extension:' && there.protocol === 'chrome-extension:' && here.host === there.host
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------- misc actions

  print(): void {
    this.wc.print({ printBackground: true })
  }

  toggleDevTools(): void {
    if (this.wc.isDevToolsOpened()) this.wc.closeDevTools()
    else this.wc.openDevTools({ mode: 'detach' })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const wc = this.wc
    if (wc.isDestroyed()) {
      services.sessions.release(this.partition)
      return
    }
    services.permissions.cancelForWebContents(wc.id)
    services.shields.forgetTab(wc.id)
    services.media.forgetTab(wc.id)
    registry.unregister(wc.id)
    wc.close({ waitForBeforeUnload: false })
    services.sessions.release(this.partition)
  }
}
