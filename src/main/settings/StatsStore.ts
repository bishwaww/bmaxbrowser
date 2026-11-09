import { app } from 'electron'
import { join } from 'node:path'
import type { PrivacyStats } from '@shared/settings'
import { readJson, writeJsonAtomic } from './JsonStore'

/** Lifetime counters only (three numbers) — no URLs, no hostnames. */
export class StatsStore {
  private stats: PrivacyStats = { adsBlocked: 0, trackersBlocked: 0, timeSavedMs: 0 }
  private file = ''
  private dirty = false
  private timer: NodeJS.Timeout | null = null

  load(): void {
    this.file = join(app.getPath('userData'), 'stats.json')
    const raw = readJson(this.file) as Partial<PrivacyStats> | undefined
    if (raw) {
      for (const k of Object.keys(this.stats) as (keyof PrivacyStats)[]) {
        const v = raw[k]
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) this.stats[k] = v
      }
    }
    this.timer = setInterval(() => this.flush(), 30_000)
    this.timer.unref()
  }

  get(): PrivacyStats {
    return { ...this.stats }
  }

  add(delta: Partial<PrivacyStats>): void {
    for (const k of Object.keys(delta) as (keyof PrivacyStats)[]) this.stats[k] += delta[k] ?? 0
    this.dirty = true
  }

  flush(): void {
    if (!this.dirty || !this.file) return
    this.dirty = false
    try {
      writeJsonAtomic(this.file, this.stats)
    } catch (err) {
      console.error('[stats] save failed', err)
    }
  }
}
