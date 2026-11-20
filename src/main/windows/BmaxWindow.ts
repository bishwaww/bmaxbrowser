import { BaseWindow, dialog, nativeTheme, WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import { writeFile } from 'node:fs/promises'
import { internalUrl } from '@shared/internal'
import type { InternalPage } from '@shared/internal'
import { IPC_PUSH } from '@shared/ipc'
import type { PushMessage } from '@shared/ipc'
import { resolveOmnibox } from '@shared/omnibox'
import type { ShortcutCommand } from '@shared/shortcuts'
import { matchShortcut } from '@shared/shortcuts'
import type { PermissionPromptData, WindowState } from '@shared/types'
import { internalPageOf, resolveLoadUrl } from '../app/internal-pages'
import { iconPath, preloadPath } from '../app/paths'
import { registry } from '../app/registry'
import { services } from '../services'
import { PRIVATE_PARTITION } from '../sessions/SessionManager'
import { Tab } from '../tabs/Tab'
import { OverlayManager } from './OverlayManager'
import { BOOKMARKS_H, CHROME_H, chromeColors, TABSTRIP_H } from './theme'

export interface WindowOptions {
  /** URL for the first tab; omitted → homepage. */
  url?: string
  /** Do not create a first tab (tear-off supplies one). */
  empty?: boolean
  partition?: string
  isolated?: boolean
  /** Extension window (partition must be EXT_PARTITION). */
  extensions?: boolean
  /** Tor window (its partition must come from SessionManager.prepareTor). */
  tor?: boolean
  bounds?: Partial<Rectangle>
}

let windowSeq = 0

export class BmaxWindow {
  readonly id = ++windowSeq
  readonly base: BaseWindow
  readonly chromeView: WebContentsView
  readonly overlays: OverlayManager
  readonly partition: string
  readonly isolated: boolean
  readonly extensions: boolean
  readonly tor: boolean
  tabs: Tab[] = []
  activeTab: Tab | null = null
  private htmlFullscreen = false
  private pushQueued = false
  private disposed = false
  private lastFindText = ''
  private shown = false

  constructor(opts: WindowOptions = {}) {
    this.isolated = opts.isolated ?? false
    this.extensions = opts.extensions ?? false
    this.tor = opts.tor ?? false
    this.partition = opts.partition ?? (this.isolated ? services.sessions.newIsolatedPartition() : PRIVATE_PARTITION)
    const dark = nativeTheme.shouldUseDarkColors
    const colors = chromeColors(dark, this.tor)

    const icon = iconPath()
    this.base = new BaseWindow({
      ...(icon ? { icon } : {}),
      width: 1280,
      height: 820,
      minWidth: 480,
      minHeight: 320,
      ...opts.bounds,
      show: false,
      title: 'BMAX Browser',
      backgroundColor: colors.strip,
      titleBarStyle: 'hidden',
      titleBarOverlay:
        process.platform === 'darwin' ? false : { color: colors.strip, symbolColor: colors.symbol, height: TABSTRIP_H },
      trafficLightPosition: { x: 14, y: 12 }
    })

    this.chromeView = new WebContentsView({
      webPreferences: {
        session: services.sessions.ui(),
        preload: preloadPath('chrome'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        safeDialogs: true
      }
    })
    this.chromeView.setBackgroundColor(colors.strip)
    registry.register(this.chromeView.webContents, { role: 'chrome', window: this })
    this.base.contentView.addChildView(this.chromeView)
    this.overlays = new OverlayManager(this)

    const cwc = this.chromeView.webContents
    cwc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const cmd = matchShortcut(input, process.platform)
      if (cmd) {
        event.preventDefault()
        this.execute(cmd)
      }
    })
    cwc.setWindowOpenHandler(() => ({ action: 'deny' }))
    cwc.once('did-finish-load', () => this.reveal())
    setTimeout(() => this.reveal(), 4000).unref()
    void cwc.loadURL(resolveLoadUrl(internalUrl('chrome')))

    const relayout = (): void => {
      this.layout()
      this.overlays.hideTransient()
    }
    this.base.on('resize', relayout)
    this.base.on('enter-full-screen', () => this.layout())
    this.base.on('leave-full-screen', () => this.layout())
    this.base.on('focus', () => services.windows.setCurrent(this))
    // Remember the other windows before this one disappears (session restore keeps the last real state).
    this.base.on('close', () => services.restore?.flush(this))
    this.base.on('closed', () => this.dispose())

    if (!opts.empty) this.openTab(opts.url ?? services.settings.get().homepage, { background: false })
    this.layout()
  }

  private reveal(): void {
    if (this.shown || this.disposed) return
    this.shown = true
    if (services.metrics && services.metrics.firstWindowMs === null) services.metrics.firstWindowMs = Math.round(process.uptime() * 1000)
    this.base.show()
  }

  // ---------------------------------------------------------------- layout / state

  contentSize(): [number, number] {
    const [w = 0, h = 0] = this.base.getContentSize()
    return [w, h]
  }

  /** Height of the browser UI above the page: tab strip + toolbar (+ bookmarks bar when shown). */
  chromeHeight(): number {
    return CHROME_H + (services.settings.get().showBookmarksBar ? BOOKMARKS_H : 0)
  }

  layout(): void {
    if (this.disposed) return
    const [w, h] = this.contentSize()
    const hideChrome = this.base.isFullScreen()
    const chromeH = hideChrome ? 0 : this.chromeHeight()
    this.chromeView.setVisible(!hideChrome)
    this.chromeView.setBounds({ x: 0, y: 0, width: w, height: chromeH })
    this.activeTab?.view.setBounds({ x: 0, y: chromeH, width: w, height: Math.max(0, h - chromeH) })
  }

  notify(): void {
    services.restore?.markDirty()
    if (this.pushQueued || this.disposed) return
    this.pushQueued = true
    queueMicrotask(() => {
      this.pushQueued = false
      this.pushState()
    })
  }

  state(): WindowState {
    const active = this.activeTab
    return {
      windowId: this.id,
      platform: process.platform as WindowState['platform'],
      tabs: this.tabs.map((t) => t.info()),
      activeTabId: active?.id ?? null,
      fullscreen: this.base.isFullScreen(),
      progress: active?.loading ? active.progress : 0,
      zoomPercent: active ? Math.round(active.zoomFactor * 100) : 100,
      isolated: this.isolated,
      extensions: this.extensions,
      theme: this.tor ? 'tor' : nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      showHomeButton: services.settings.get().showHomeButton,
      showBookmarksBar: services.settings.get().showBookmarksBar,
      tor: this.tor
    }
  }

  pushState(): void {
    const msg: PushMessage = { type: 'state', state: this.state() }
    this.sendToChrome(msg)
    this.overlays.broadcast(msg)
  }

  sendToChrome(msg: PushMessage): void {
    const wc = this.chromeView.webContents
    if (!this.disposed && !wc.isDestroyed()) wc.send(IPC_PUSH, msg)
  }

  applyTheme(): void {
    if (this.disposed) return
    const colors = chromeColors(nativeTheme.shouldUseDarkColors, this.tor)
    this.base.setBackgroundColor(colors.strip)
    this.chromeView.setBackgroundColor(colors.strip)
    if (process.platform !== 'darwin') {
      try {
        this.base.setTitleBarOverlay({ color: colors.strip, symbolColor: colors.symbol, height: TABSTRIP_H })
      } catch {
        /* not supported on this platform/version */
      }
    }
    this.notify()
  }

  focusOmnibox(select = true): void {
    this.chromeView.webContents.focus()
    this.sendToChrome({ type: 'focus-omnibox', select })
  }

  // ---------------------------------------------------------------- tabs

  tabById(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  private pinnedCount(): number {
    return this.tabs.filter((t) => t.pinned).length
  }

  openTab(url: string, opts: { background?: boolean; partition?: string; index?: number; lazy?: boolean } = {}): Tab {
    const tab = new Tab(this, opts.partition ?? this.partition, url, { lazy: opts.lazy ?? false })
    const idx = opts.index ?? this.tabs.length
    this.tabs.splice(Math.max(this.pinnedCount(), Math.min(idx, this.tabs.length)), 0, tab)
    if (!opts.background) {
      this.activate(tab)
      if (internalPageOf(url) === 'newtab') this.focusOmnibox()
    }
    this.notify()
    return tab
  }

  activate(tab: Tab): void {
    if (this.activeTab === tab || !this.tabs.includes(tab)) return
    const prev = this.activeTab
    if (prev) {
      prev.lastActiveAt = Date.now()
      if (this.overlays.isVisible('find')) this.stopFind()
      if (this.base.contentView.children.includes(prev.view)) this.base.contentView.removeChildView(prev.view)
    }
    this.activeTab = tab
    tab.lastActiveAt = Date.now()
    if (tab.sleeping) tab.wake()
    this.base.contentView.addChildView(tab.view)
    this.layout()
    this.overlays.hideTransient()
    this.overlays.raise()
    if (!tab.isDestroyed && internalPageOf(tab.wc.getURL()) !== 'newtab') tab.wc.focus()
    this.notify()
  }

  closeTab(tab: Tab): void {
    const idx = this.tabs.indexOf(tab)
    if (idx < 0) return
    const url = tab.url
    if (url && !url.startsWith('bmax://') && !url.startsWith('view-source:')) services.windows.rememberClosed(url)
    this.tabs.splice(idx, 1)
    if (this.base.contentView.children.includes(tab.view)) this.base.contentView.removeChildView(tab.view)
    const wasActive = this.activeTab === tab
    tab.destroy()
    if (this.tabs.length === 0) {
      this.activeTab = null
      this.base.close()
      return
    }
    if (wasActive) {
      this.activeTab = null
      this.activate(this.tabs[Math.min(idx, this.tabs.length - 1)]!)
    }
    this.notify()
  }

  /** Remove a tab without destroying it (tear-off / move to another window). */
  detachTab(tab: Tab): void {
    const idx = this.tabs.indexOf(tab)
    if (idx < 0) return
    this.tabs.splice(idx, 1)
    if (this.base.contentView.children.includes(tab.view)) this.base.contentView.removeChildView(tab.view)
    if (this.activeTab === tab) {
      this.activeTab = null
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)]
      if (next) this.activate(next)
    }
    this.notify()
  }

  attachTab(tab: Tab, index = this.tabs.length): void {
    tab.window = this
    const min = tab.pinned ? 0 : this.pinnedCount()
    const max = tab.pinned ? this.pinnedCount() : this.tabs.length
    this.tabs.splice(Math.max(min, Math.min(index, max)), 0, tab)
    this.activate(tab)
    this.notify()
  }

  moveTab(tab: Tab, index: number): void {
    const from = this.tabs.indexOf(tab)
    if (from < 0) return
    const pinned = this.pinnedCount()
    const lo = tab.pinned ? 0 : pinned
    const hi = tab.pinned ? pinned - 1 : this.tabs.length - 1
    const to = Math.max(lo, Math.min(index, hi))
    this.tabs.splice(from, 1)
    this.tabs.splice(to, 0, tab)
    this.notify()
  }

  setPinned(tab: Tab, pinned: boolean): void {
    if (tab.pinned === pinned) return
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    tab.pinned = pinned
    // pinned: end of the pinned group; unpinned: first slot after the pinned group
    this.tabs.splice(this.pinnedCount(), 0, tab)
    this.notify()
  }

  duplicate(tab: Tab): void {
    const idx = this.tabs.indexOf(tab)
    this.openTab(tab.url, { index: idx + 1, partition: tab.partition })
  }

  closeOthers(tab: Tab): void {
    for (const t of [...this.tabs]) if (t !== tab && !t.pinned) this.closeTab(t)
  }

  closeRight(tab: Tab): void {
    const idx = this.tabs.indexOf(tab)
    for (const t of this.tabs.slice(idx + 1)) if (!t.pinned) this.closeTab(t)
  }

  // ---------------------------------------------------------------- navigation

  go(input: string, newTab = false): void {
    const result = resolveOmnibox(input, services.settings.get().searchEngine)
    if (newTab || !this.activeTab) this.openTab(result.url)
    else {
      this.activeTab.loadUrl(result.url)
      this.activeTab.wc.focus()
    }
  }

  // ---------------------------------------------------------------- find

  showFind(): void {
    if (!this.activeTab) return
    const [cw] = this.contentSize()
    this.overlays.show('find', { x: Math.max(8, cw - 392), y: this.chromeHeight() + 6, width: 380, height: 48 }, { text: this.lastFindText })
  }

  runFind(text: string, forward: boolean, findNext: boolean): void {
    const wc = this.activeTab?.wc
    if (!wc) return
    if (!text) {
      wc.stopFindInPage('clearSelection')
      this.overlays.send('find', { type: 'find-result', activeMatch: 0, matches: 0 })
      return
    }
    this.lastFindText = text
    wc.findInPage(text, { forward, findNext, matchCase: false })
  }

  stopFind(): void {
    this.activeTab?.wc.stopFindInPage('clearSelection')
    this.overlays.hide('find')
  }

  onFound(tab: Tab, activeMatch: number, matches: number): void {
    if (tab === this.activeTab) this.overlays.send('find', { type: 'find-result', activeMatch, matches })
  }

  // ---------------------------------------------------------------- permission prompt

  showPermissionPrompt(data: PermissionPromptData): void {
    this.overlays.show('permission', { x: 12, y: this.chromeHeight() + 4, width: 380, height: 150 }, data)
  }

  // ---------------------------------------------------------------- fullscreen

  setHtmlFullscreen(on: boolean): void {
    this.htmlFullscreen = on
    this.base.setFullScreen(on)
    this.layout()
  }

  // ---------------------------------------------------------------- commands

  execute(cmd: ShortcutCommand | string): void {
    const tab = this.activeTab
    switch (cmd) {
      case 'newTab':
        this.openTab(internalUrl('newtab'))
        return
      case 'closeTab':
        if (tab) this.closeTab(tab)
        return
      case 'reopenTab': {
        const url = services.windows.popClosed()
        if (url) this.openTab(url)
        return
      }
      case 'focusAddress':
        this.focusOmnibox()
        return
      case 'nextTab':
      case 'prevTab': {
        if (this.tabs.length < 2 || !tab) return
        const d = cmd === 'nextTab' ? 1 : -1
        const i = (this.tabs.indexOf(tab) + d + this.tabs.length) % this.tabs.length
        this.activate(this.tabs[i]!)
        return
      }
      case 'lastTab':
        if (this.tabs.length) this.activate(this.tabs[this.tabs.length - 1]!)
        return
      case 'find':
        this.showFind()
        return
      case 'findNext':
      case 'findPrev':
        if (this.lastFindText) this.runFind(this.lastFindText, cmd === 'findNext', true)
        return
      case 'print':
        tab?.print()
        return
      case 'zoomIn':
        tab?.zoom('in')
        return
      case 'zoomOut':
        tab?.zoom('out')
        return
      case 'zoomReset':
        tab?.zoom('reset')
        return
      case 'reload':
        tab?.reload()
        return
      case 'hardReload':
        tab?.reload(true)
        return
      case 'fullscreen':
        this.base.setFullScreen(!this.base.isFullScreen())
        return
      case 'devtools':
        tab?.toggleDevTools()
        return
      case 'viewSource':
        if (tab && /^(https?|file):/i.test(tab.url)) this.openTab(`view-source:${tab.url}`)
        return
      case 'newWindow':
      case 'newIsolatedWindow':
        // A new window opened from a Tor window is another Tor window (never a clearnet one).
        if (this.tor) void services.windows.createTor()
        else services.windows.create({ isolated: cmd === 'newIsolatedWindow' })
        return
      case 'newExtensionWindow':
        if (!this.tor) void services.windows.createExtensionWindow()
        return
      case 'savePage':
        void this.savePage()
        return
      case 'back':
        tab?.back()
        return
      case 'forward':
        tab?.forward()
        return
      case 'home':
        tab?.loadUrl(services.settings.get().homepage)
        return
      case 'closeWindow':
        this.base.close()
        return
      case 'settings': {
        const existing = this.tabs.find((t) => internalPageOf(t.wc.getURL()) === 'settings')
        if (existing) this.activate(existing)
        else this.openTab(internalUrl('settings'))
        return
      }
      case 'burn':
        void services.windows.burn()
        return
      case 'newTorWindow':
        void services.windows.createTor()
        return
      case 'bookmarkPage':
        this.toggleBookmark()
        return
      case 'toggleBookmarksBar':
        services.settings.update({ showBookmarksBar: !services.settings.get().showBookmarksBar })
        return
      case 'bookmarks':
        this.openInternal('bookmarks')
        return
      case 'downloadMedia': {
        const [cw] = this.contentSize()
        if (tab) this.overlays.show('media', { x: Math.max(8, cw - 420), y: this.chromeHeight() + 4, width: 408, height: 420 }, {})
        return
      }
      case 'readerMode':
        if (tab && !tab.sleeping) void services.reader.open(tab)
        return
      case 'pictureInPicture':
        if (tab) void tab.togglePictureInPicture()
        return
      case 'downloads': {
        const existing = this.tabs.find((t) => internalPageOf(t.wc.getURL()) === 'downloads')
        if (existing) this.activate(existing)
        else this.openTab(internalUrl('downloads'))
        return
      }
      default:
        if (typeof cmd === 'string' && cmd.startsWith('selectTab:')) {
          const n = Number(cmd.split(':')[1])
          const t = this.tabs[n - 1]
          if (t) this.activate(t)
        }
    }
  }

  /** Open an internal page in a tab, reusing an existing tab on that page. */
  openInternal(page: InternalPage): void {
    const existing = this.tabs.find((t) => internalPageOf(t.wc.getURL()) === page)
    if (existing) this.activate(existing)
    else this.openTab(internalUrl(page))
  }

  private toggleBookmark(): void {
    const tab = this.activeTab
    if (!tab || !/^https?:\/\//i.test(tab.url)) return
    const store = services.bookmarks
    if (store.has(tab.url)) store.removeByUrl(tab.url)
    else store.add({ title: tab.title, url: tab.url, icon: tab.favicon })
    this.notify()
  }

  private async savePage(): Promise<void> {
    const tab = this.activeTab
    if (!tab || !/^(https?|file):/i.test(tab.url)) return
    const base = tab.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'page'
    const res = await dialog.showSaveDialog(this.base, {
      defaultPath: `${base}.html`,
      filters: [
        { name: 'Web Page, Complete', extensions: ['html'] },
        { name: 'Web Page, HTML Only', extensions: ['html'] }
      ]
    })
    if (res.canceled || !res.filePath) return
    try {
      await tab.wc.savePage(res.filePath, 'HTMLComplete')
    } catch (err) {
      console.error('[savePage] failed, falling back to HTML only', err)
      try {
        await writeFile(res.filePath, await tab.wc.executeJavaScript('document.documentElement.outerHTML'), 'utf8')
      } catch {
        /* ignore */
      }
    }
  }

  // ---------------------------------------------------------------- lifecycle

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const t of this.tabs) t.destroy()
    this.tabs = []
    this.overlays.destroy()
    const wc = this.chromeView.webContents
    registry.unregister(wc.id)
    if (!wc.isDestroyed()) wc.close()
    services.windows.remove(this)
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Whether this window is currently in HTML (video) fullscreen. */
  get inHtmlFullscreen(): boolean {
    return this.htmlFullscreen
  }
}
