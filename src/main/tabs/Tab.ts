import { WebContentsView } from 'electron'
import type { Session, WebContents } from 'electron'
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
  private lastFaviconUrl = ''
  private destroyed = false

  constructor(window: BmaxWindow, partition: string, url?: string) {
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
    this.loadUrl(url ?? services.settings.get().homepage)
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
    if (hard) this.wc.reloadIgnoringCache()
    else this.wc.reload()
  }
  stop(): void {
    this.wc.stop()
  }

  // ---------------------------------------------------------------- state

  /** URL shown in the address bar (the failed URL on the error page, the typed URL while loading). */
  get url(): string {
    const current = toLogicalUrl(this.wc.getURL())
    const parsed = parseInternalUrl(current)
    if (parsed?.page === 'error' || parsed?.page === 'warning') {
      const failed = new URLSearchParams(parsed.search).get('url')
      if (failed) return failed
    }
    if (this.pendingUrl && (this.loading || !current)) return this.pendingUrl
    return current
  }

  get title(): string {
    const url = this.url
    const parsed = parseInternalUrl(toLogicalUrl(this.wc.getURL()))
    if (parsed?.page === 'newtab') return 'New Tab'
    if (parsed?.page === 'settings') return 'Settings'
    if (parsed?.page === 'error') return "Can't reach this page"
    if (parsed?.page === 'warning') return 'Connection not secure'
    if (parsed?.page === 'tor') return 'Connecting to Tor'
    if (parsed?.page === 'bookmarks') return 'Bookmarks'
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
      container: services.sessions.containerLabel(this.partition),
      bookmarked: services.vault.hasBookmark(url),
      shields: services.shields.tabSummary(this.wc.id, url)
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
        services.permissions.cancelForWebContents(wc.id)
        this.window.overlays.hideTransient()
        this.window.overlays.hide('find')
      }
    })
    wc.on('did-navigate', () => {
      this.pageLoadedAt = Date.now()
      upgradedNavigations.delete(wc.id)
      this.pendingUrl = null
      this.lastFaviconUrl = ''
      this.favicon = null
      this.applyStoredZoom()
      notify()
    })
    wc.on('did-navigate-in-page', notify)
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
    registry.unregister(wc.id)
    wc.close({ waitForBeforeUnload: false })
    services.sessions.release(this.partition)
  }
}
