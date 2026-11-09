import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, settingsSchema } from '@shared/settings'
import type { Settings, SettingsPatch } from '@shared/settings'
import { readJson, writeJsonAtomic } from './JsonStore'

export class SettingsStore extends EventEmitter {
  private settings: Settings = structuredClone(DEFAULT_SETTINGS)
  private file = ''
  private timer: NodeJS.Timeout | null = null

  load(): void {
    this.file = join(app.getPath('userData'), 'settings.json')
    const raw = readJson(this.file)
    if (raw && typeof raw === 'object') {
      // Validate field by field so one bad value never resets everything.
      const merged: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>
      for (const key of Object.keys(settingsSchema.shape) as (keyof Settings)[]) {
        const candidate = (raw as Record<string, unknown>)[key]
        if (candidate === undefined) continue
        const ok = settingsSchema.shape[key].safeParse(candidate)
        if (ok.success) merged[key] = ok.data
      }
      this.settings = merged as unknown as Settings
    }
  }

  get(): Settings {
    return this.settings
  }

  update(patch: SettingsPatch): Settings {
    const next = { ...this.settings } as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
    this.settings = settingsSchema.parse(next)
    this.scheduleSave()
    this.emit('change', this.settings)
    return this.settings
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.file) return
    try {
      writeJsonAtomic(this.file, this.settings)
    } catch (err) {
      console.error('[settings] save failed', err)
    }
  }
}
