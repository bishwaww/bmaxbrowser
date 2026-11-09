import { app } from 'electron'
import type { Session, WebContents } from 'electron'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import type { PermissionPromptData } from '@shared/types'
import type { SettingsStore } from '../settings/SettingsStore'
import { readJson, writeJsonAtomic } from '../settings/JsonStore'
import type { BmaxWindow } from '../windows/BmaxWindow'
import { registry } from '../app/registry'

type Decision = 'allow' | 'deny'

/** Permissions granted without asking (needed for normal pages to work, low risk). */
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read-write-disabled'])
/** Prompted permissions → human label. */
const LABELS: Record<string, string> = {
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'read your clipboard',
  midi: 'use MIDI devices'
}

interface Pending {
  data: PermissionPromptData
  key: string
  storeKey: string
  window: BmaxWindow
  wcId: number
  callback: (granted: boolean) => void
}

function describe(permission: string, details: { mediaTypes?: string[] }): { key: string; label: string } | null {
  if (permission === 'media') {
    const types = details.mediaTypes ?? []
    const video = types.includes('video')
    const audio = types.includes('audio')
    if (!video && !audio) return null
    const key = `media:${[video && 'video', audio && 'audio'].filter(Boolean).join('+')}`
    const label = video && audio ? 'use your camera and microphone' : video ? 'use your camera' : 'use your microphone'
    return { key, label }
  }
  const label = LABELS[permission]
  return label ? { key: permission, label } : null
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/**
 * Per-site permission prompts. Default: ask (or deny-all via settings). Decisions live in memory and are only
 * written to disk if the user enables "remember permissions across restarts".
 */
export class PermissionManager {
  private decisions = new Map<string, Decision>()
  private pending = new Map<number, Pending>()
  private queues = new Map<BmaxWindow, number[]>()
  private nextId = 1
  private file = ''

  constructor(private settings: SettingsStore) {}

  init(): void {
    this.file = join(app.getPath('userData'), 'permissions.json')
    if (this.settings.get().permissions.persist) {
      const raw = readJson(this.file)
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (v === 'allow' || v === 'deny') this.decisions.set(k, v)
        }
      }
    }
    this.settings.on('change', () => {
      if (!this.settings.get().permissions.persist && existsSync(this.file)) rmSync(this.file, { force: true })
    })
  }

  /** Tor sessions deny every permission (camera, microphone, location, notifications, …) without asking. */
  attach(ses: Session, tor = false): void {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (tor) return callback(AUTO_ALLOW.has(permission))
      this.request(wc, permission, callback, details as unknown as { requestingUrl?: string; mediaTypes?: string[] })
    })
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
      if (AUTO_ALLOW.has(permission)) return true
      if (tor) return false
      const info = wc ? registry.get(wc.id) : undefined
      const partition = info?.role === 'tab' ? info.tab.partition : 'unknown'
      const probe = permission === 'media' ? ['media:video', 'media:audio', 'media:video+audio'] : [permission]
      return probe.some((k) => this.decisions.get(`${partition}|${requestingOrigin}|${k}`) === 'allow')
    })
  }

  private request(
    wc: WebContents | null,
    permission: string,
    callback: (granted: boolean) => void,
    details: { requestingUrl?: string; mediaTypes?: string[] }
  ): void {
    if (AUTO_ALLOW.has(permission)) return callback(true)
    const info = wc ? registry.get(wc.id) : undefined
    const origin = originOf(details.requestingUrl ?? wc?.getURL() ?? '')
    const desc = describe(permission, details)
    if (!wc || info?.role !== 'tab' || !origin || !desc) return callback(false)

    const storeKey = `${info.tab.partition}|${origin}|${desc.key}`
    const stored = this.decisions.get(storeKey)
    if (stored) return callback(stored === 'allow')
    if (this.settings.get().permissions.defaultAction === 'deny') return callback(false)

    const requestId = this.nextId++
    const window = info.tab.window
    this.pending.set(requestId, {
      data: { requestId, origin, permission: desc.key, label: desc.label },
      key: desc.key,
      storeKey,
      window,
      wcId: wc.id,
      callback
    })
    const q = this.queues.get(window) ?? []
    q.push(requestId)
    this.queues.set(window, q)
    if (q.length === 1) this.showNext(window)
  }

  private showNext(window: BmaxWindow): void {
    const q = this.queues.get(window)
    const id = q?.[0]
    if (id === undefined) return window.overlays.hide('permission')
    const p = this.pending.get(id)
    if (p) window.showPermissionPrompt(p.data)
  }

  respond(requestId: number, allow: boolean, remember: boolean): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    const q = this.queues.get(p.window)
    if (q) this.queues.set(p.window, q.filter((x) => x !== requestId))
    p.callback(allow)
    if (remember) {
      this.decisions.set(p.storeKey, allow ? 'allow' : 'deny')
      this.persist()
    }
    this.showNext(p.window)
  }

  /** Deny anything still pending for a tab (navigated away or closed). */
  cancelForWebContents(wcId: number): void {
    for (const [id, p] of [...this.pending]) {
      if (p.wcId === wcId) this.respond(id, false, false)
    }
  }

  reset(): void {
    for (const id of [...this.pending.keys()]) this.respond(id, false, false)
    this.decisions.clear()
    if (existsSync(this.file)) rmSync(this.file, { force: true })
  }

  private persist(): void {
    if (!this.settings.get().permissions.persist) return
    try {
      writeJsonAtomic(this.file, Object.fromEntries(this.decisions))
    } catch (err) {
      console.error('[permissions] save failed', err)
    }
  }
}
