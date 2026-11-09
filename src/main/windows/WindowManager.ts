import { app, screen } from 'electron'
import type { Rectangle } from 'electron'
import { internalUrl } from '@shared/internal'
import { clearPrivacyExceptions } from '../net/privacy-handlers'
import { services } from '../services'
import { clearFaviconCache } from '../tabs/favicon'
import { ZoomStore } from '../tabs/zoom'
import type { Tab } from '../tabs/Tab'
import { BmaxWindow } from './BmaxWindow'
import type { WindowOptions } from './BmaxWindow'
import { CHROME_H } from './theme'

export class WindowManager {
  readonly zoom = new ZoomStore()
  private windows = new Set<BmaxWindow>()
  private current: BmaxWindow | null = null
  /** URLs of recently closed tabs for Ctrl+Shift+T. Memory only; cleared by Burn. */
  private closed: string[] = []

  create(opts: WindowOptions = {}): BmaxWindow {
    const bounds = opts.bounds ?? this.cascadeBounds()
    const win = new BmaxWindow({ ...opts, bounds })
    this.windows.add(win)
    this.current = win
    return win
  }

  private cascadeBounds(): Partial<Rectangle> | undefined {
    const cur = this.current
    if (!cur || cur.isDisposed || cur.base.isMaximized() || cur.base.isFullScreen()) return undefined
    const b = cur.base.getBounds()
    return { x: b.x + 28, y: b.y + 28, width: b.width, height: b.height }
  }

  all(): BmaxWindow[] {
    return [...this.windows]
  }

  focused(): BmaxWindow | null {
    return this.current && !this.current.isDisposed ? this.current : (this.all()[0] ?? null)
  }

  setCurrent(win: BmaxWindow): void {
    this.current = win
  }

  /** Tor window: reserve the proxy port, build a fully proxied session, THEN open the window (fail closed). */
  async createTor(): Promise<BmaxWindow> {
    const port = await services.tor.reservePort()
    const partition = await services.sessions.prepareTor(port)
    const win = this.create({ url: internalUrl('tor'), partition, tor: true, isolated: true })
    void services.tor.start()
    return win
  }

  /** Burn: wipe every session, close every tab and window, forget everything, open one fresh window. */
  async burn(): Promise<void> {
    const old = this.all()
    const fresh = this.create({})
    for (const w of old) w.base.close()
    await services.sessions.burnAll()
    services.permissions.reset()
    services.vault.lock()
    this.zoom.clear()
    this.clearClosed()
    clearFaviconCache()
    clearPrivacyExceptions()
    fresh.notify()
  }

  remove(win: BmaxWindow): void {
    this.windows.delete(win)
    if (win.tor && !this.all().some((w) => w.tor)) services.tor.stop()
    if (this.current === win) this.current = this.all()[0] ?? null
    if (this.windows.size === 0) app.quit()
  }

  rememberClosed(url: string): void {
    this.closed.push(url)
    if (this.closed.length > 25) this.closed.shift()
  }

  popClosed(): string | undefined {
    return this.closed.pop()
  }

  clearClosed(): void {
    this.closed = []
  }

  /** Window whose tab strip is under a screen point (for dropping a dragged tab onto another window). */
  private windowAtStrip(x: number, y: number, exclude: BmaxWindow): BmaxWindow | null {
    for (const w of this.windows) {
      if (w === exclude || w.isDisposed || w.base.isMinimized() || w.tor !== exclude.tor) continue
      const b = w.base.getContentBounds()
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + CHROME_H) return w
    }
    return null
  }

  /** Move a tab to another window's strip (if dropped there) or into a brand-new window at the drop point. */
  tearOff(tab: Tab, screenX: number, screenY: number): void {
    const source = tab.window
    const target = this.windowAtStrip(screenX, screenY, source)
    if (!target && source.tabs.length <= 1) return // single tab in its own window: nothing to tear off
    if (target) {
      source.detachTab(tab)
      target.attachTab(tab)
      target.base.focus()
      if (source.tabs.length === 0) source.base.close()
      return
    }
    const sb = source.base.getBounds()
    const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY })
    const width = Math.min(sb.width, display.workArea.width)
    const height = Math.min(sb.height, display.workArea.height)
    const win = this.create({
      empty: true,
      partition: tab.partition,
      isolated: source.isolated,
      tor: source.tor,
      bounds: { x: Math.round(screenX - 120), y: Math.round(screenY - 16), width, height }
    })
    source.detachTab(tab)
    win.attachTab(tab)
  }
}
