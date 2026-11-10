import { app, screen } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { readJson, writeJsonAtomic } from '../settings/JsonStore'
import { services } from '../services'
import { PRIVATE_PARTITION } from '../sessions/SessionManager'
import type { BmaxWindow } from '../windows/BmaxWindow'

/** Only addresses are stored — no titles, no cookies, no page data. */
const sessionSchema = z.object({
  windows: z
    .array(
      z.object({
        bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
        maximized: z.boolean(),
        active: z.number().int().min(0),
        tabs: z.array(z.object({ url: z.string().max(8192), pinned: z.boolean() })).min(1).max(300)
      })
    )
    .max(20)
})
export type SessionData = z.infer<typeof sessionSchema>

const SAVEABLE = /^(https?|file):/i

/**
 * Opt-in "continue where you left off" (Settings → General). OFF by default; when on, the addresses of open tabs
 * are written to session.json in the app data folder. Tor windows, isolated windows and container tabs are never
 * saved. Turning the setting off, or Burn, deletes the file.
 */
export class SessionRestore {
  private file = ''
  private timer: NodeJS.Timeout | null = null
  private suppressed = false

  init(): void {
    this.file = join(app.getPath('userData'), 'session.json')
    if (!this.enabled()) this.remove()
  }

  private enabled(): boolean {
    return services.settings.get().general.restoreSession
  }

  private remove(): void {
    try {
      rmSync(this.file, { force: true })
    } catch {
      /* nothing to delete */
    }
  }

  /** Debounced save after any window/tab change. */
  markDirty(): void {
    if (!this.enabled() || this.suppressed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 1500)
    this.timer.unref()
  }

  snapshot(exclude?: BmaxWindow): SessionData {
    const windows: SessionData['windows'] = []
    for (const w of services.windows.all()) {
      if (w === exclude || w.isDisposed || w.tor || w.isolated) continue
      const tabs = w.tabs.filter((t) => t.partition === PRIVATE_PARTITION && SAVEABLE.test(t.url))
      if (tabs.length === 0) continue
      const b = w.base.getNormalBounds()
      const activeIdx = w.activeTab ? tabs.indexOf(w.activeTab) : -1
      windows.push({
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
        maximized: w.base.isMaximized(),
        active: Math.max(0, activeIdx),
        tabs: tabs.slice(0, 300).map((t) => ({ url: t.url, pinned: t.pinned }))
      })
    }
    return { windows }
  }

  /** Write the current state. An empty state (everything closed) never overwrites the last real one. */
  flush(exclude?: BmaxWindow): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.enabled() || this.suppressed || !this.file) return
    const data = this.snapshot(exclude)
    if (data.windows.length === 0) return
    try {
      writeJsonAtomic(this.file, data)
    } catch (err) {
      console.error('[session] save failed', err)
    }
  }

  /** Burn: forget everything and ignore the windows that are about to close. */
  suppress(on: boolean): void {
    this.suppressed = on
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  clear(): void {
    this.remove()
  }

  read(): SessionData | null {
    if (!this.enabled()) return null
    const parsed = sessionSchema.safeParse(readJson(this.file))
    return parsed.success && parsed.data.windows.length > 0 ? parsed.data : null
  }

  /** Re-open the saved windows. Only the selected tab of each window loads; the rest wait asleep until clicked. Returns the number of windows created. */
  restore(): number {
    const data = this.read()
    if (!data) return 0
    const displays = screen.getAllDisplays().map((d) => d.workArea)
    let created = 0
    for (const w of data.windows) {
      let bounds: { x?: number; y?: number; width: number; height: number } | undefined
      if (w.bounds) {
        const b = w.bounds
        const visible = displays.some((d) => b.x < d.x + d.width - 40 && b.x + b.width > d.x + 40 && b.y >= d.y - 8 && b.y < d.y + d.height - 40)
        bounds = visible ? b : { width: b.width, height: b.height }
      }
      const win = services.windows.create({ empty: true, ...(bounds ? { bounds } : {}) })
      const tabs = w.tabs.map((t, i) => {
        const tab = win.openTab(t.url, { background: true, lazy: i !== w.active })
        if (t.pinned) win.setPinned(tab, true)
        return tab
      })
      win.activate(tabs[Math.min(w.active, tabs.length - 1)]!)
      if (w.maximized) win.base.maximize()
      created++
    }
    return created
  }

  onSettingsChange(prevEnabled: boolean): void {
    const now = this.enabled()
    if (prevEnabled && !now) {
      this.suppress(false)
      this.remove()
    } else if (!prevEnabled && now) this.markDirty()
  }
}
