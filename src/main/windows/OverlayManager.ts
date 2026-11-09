import { WebContentsView } from 'electron'
import { internalUrl } from '@shared/internal'
import { IPC_PUSH } from '@shared/ipc'
import { matchShortcut } from '@shared/shortcuts'
import type { PushMessage } from '@shared/ipc'
import type { OverlayKind, Rect } from '@shared/types'
import { resolveLoadUrl } from '../app/internal-pages'
import { preloadPath } from '../app/paths'
import { registry } from '../app/registry'
import { services } from '../services'
import type { BmaxWindow } from './BmaxWindow'

interface Entry {
  view: WebContentsView
  ready: boolean
  pending: PushMessage | null
  visible: boolean
  rect: Rect
}

/** Overlays that close when the user clicks elsewhere. 'find' and 'permission' stay until dismissed. */
const TRANSIENT: OverlayKind[] = ['menu', 'cert', 'suggest', 'shields', 'media']
/** Overlays that take keyboard focus when shown (suggest must NOT: focus stays in the omnibox). */
const FOCUSING: OverlayKind[] = ['menu', 'cert', 'find', 'shields', 'media']

/**
 * Popups, menus and the find bar are separate transparent WebContentsViews stacked above the page view.
 * They are sized to their content (overlay.resize) so transparent areas never swallow clicks.
 */
export class OverlayManager {
  private entries = new Map<OverlayKind, Entry>()

  constructor(private win: BmaxWindow) {}

  private ensure(kind: OverlayKind): Entry {
    const existing = this.entries.get(kind)
    if (existing) return existing
    const view = new WebContentsView({
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
    view.setBackgroundColor('#00000000')
    const entry: Entry = { view, ready: false, pending: null, visible: false, rect: { x: 0, y: 0, width: 1, height: 1 } }
    this.entries.set(kind, entry)
    registry.register(view.webContents, { role: 'overlay', window: this.win, kind })
    view.webContents.on('blur', () => {
      if (entry.visible && TRANSIENT.includes(kind)) this.hide(kind)
    })
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key !== 'Escape') {
        const cmd = matchShortcut(input, process.platform)
        if (cmd) {
          event.preventDefault()
          this.win.execute(cmd)
        }
      }
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.hide(kind)
        if (kind === 'find') this.win.stopFind()
      }
    })
    void view.webContents.loadURL(resolveLoadUrl(internalUrl('overlay', `?kind=${kind}`)))
    return entry
  }

  show(kind: OverlayKind, rect: Rect, data: unknown): void {
    const e = this.ensure(kind)
    const [cw, ch] = this.win.contentSize()
    const r: Rect = {
      x: Math.round(Math.max(0, Math.min(rect.x, cw - 40))),
      y: Math.round(Math.max(0, Math.min(rect.y, ch - 40))),
      width: Math.round(Math.max(1, Math.min(rect.width, cw))),
      height: Math.round(Math.max(1, Math.min(rect.height, ch)))
    }
    e.rect = r
    e.view.setBounds(r)
    this.win.base.contentView.addChildView(e.view) // (re-)adding moves it to the top of the stack
    e.visible = true
    const msg: PushMessage = { type: 'overlay-data', kind, data, rect: r }
    if (e.ready) e.view.webContents.send(IPC_PUSH, msg)
    else e.pending = msg
    if (FOCUSING.includes(kind)) e.view.webContents.focus()
  }

  hide(kind: OverlayKind): void {
    const e = this.entries.get(kind)
    if (!e || !e.visible) return
    e.visible = false
    if (this.win.base.contentView.children.includes(e.view)) this.win.base.contentView.removeChildView(e.view)
    this.win.sendToChrome({ type: 'overlay-closed', kind })
  }

  hideTransient(except?: OverlayKind): void {
    for (const k of TRANSIENT) if (k !== except) this.hide(k)
  }

  hideAll(): void {
    for (const k of this.entries.keys()) this.hide(k)
  }

  isVisible(kind: OverlayKind): boolean {
    return this.entries.get(kind)?.visible ?? false
  }

  /** Keep visible overlays above the active tab view after it was (re-)attached. */
  raise(): void {
    for (const e of this.entries.values()) if (e.visible) this.win.base.contentView.addChildView(e.view)
  }

  resize(kind: OverlayKind, width: number, height: number): void {
    const e = this.entries.get(kind)
    if (!e) return
    const [cw, ch] = this.win.contentSize()
    e.rect = {
      ...e.rect,
      width: Math.round(Math.min(width, cw - e.rect.x)),
      height: Math.round(Math.min(height, ch - e.rect.y))
    }
    e.view.setBounds(e.rect)
  }

  /** Overlay renderer mounted: flush the data that was queued before it was ready. */
  ready(kind: OverlayKind): void {
    const e = this.entries.get(kind)
    if (!e) return
    e.ready = true
    if (e.pending) {
      e.view.webContents.send(IPC_PUSH, e.pending)
      e.pending = null
    }
  }

  send(kind: OverlayKind, msg: PushMessage): void {
    const e = this.entries.get(kind)
    if (e?.ready && !e.view.webContents.isDestroyed()) e.view.webContents.send(IPC_PUSH, msg)
  }

  broadcast(msg: PushMessage): void {
    for (const e of this.entries.values()) {
      if (e.ready && !e.view.webContents.isDestroyed()) e.view.webContents.send(IPC_PUSH, msg)
    }
  }

  destroy(): void {
    for (const e of this.entries.values()) {
      const wc = e.view.webContents
      registry.unregister(wc.id)
      if (!wc.isDestroyed()) wc.close()
    }
    this.entries.clear()
  }
}
