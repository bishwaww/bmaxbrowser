import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { session } from 'electron'
import type { Session } from 'electron'
import { proxyRules, uniformUserAgent, UNIFORM_ACCEPT_LANGUAGE } from '@shared/privacy'
import { registerInternalProtocol, DEV_URL } from '../app/internal-pages'
import { preloadPath } from '../app/paths'
import { configureSpellcheck } from '../privacy/spellcheck'
import type { CertCache } from '../net/cert-cache'
import type { RequestPipeline } from '../net/RequestPipeline'
import type { PermissionManager } from '../permissions/PermissionManager'
import { services } from '../services'
import type { SettingsStore } from '../settings/SettingsStore'

// Ghostery's cosmetic-filtering preload (sandbox-safe: it only needs `electron`).
const SHIELDS_PRELOAD = createRequire(__filename).resolve('@ghostery/adblocker-electron-preload')

/** No "persist:" prefix → memory-only partitions: no cookies/cache/localStorage/IndexedDB ever written to disk. */
export const PRIVATE_PARTITION = 'bmax-private'
export const UI_PARTITION = 'bmax-ui'

/** Strip the Electron / app tokens from the UA so sites see a plain Chrome. */
export function cleanUserAgent(ua: string): string {
  return ua.replace(/\s(Electron|bmax-browser|BMAX\s?Browser)\/\S+/gi, '')
}

interface Entry {
  ses: Session
  tor: boolean
  /** Containers / isolated windows / Tor windows are wiped when their last tab closes. */
  ephemeral: boolean
  refs: number
  secret: string
}

async function wipe(ses: Session): Promise<void> {
  await ses.clearStorageData().catch(() => undefined)
  await ses.clearCache().catch(() => undefined)
  await ses.clearAuthCache().catch(() => undefined)
  await ses.clearHostResolverCache().catch(() => undefined)
  await ses.clearCodeCaches({}).catch(() => undefined)
  ses.closeAllConnections().catch(() => undefined)
}

export class SessionManager {
  private entries = new Map<string, Entry>()
  private ui_: Session | null = null
  private counter = 0
  private torSocksPort = 0

  constructor(
    private deps: {
      pipeline: RequestPipeline
      permissions: PermissionManager
      certs: CertCache
      settings: SettingsStore
    }
  ) {}

  /** Session for browser UI (chrome, overlays): internal pages only, all network blocked. */
  ui(): Session {
    if (this.ui_) return this.ui_
    const ses = session.fromPartition(UI_PARTITION)
    registerInternalProtocol(ses)
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)
    ses.webRequest.onBeforeRequest((details, cb) => {
      const u = details.url
      const allowed =
        u.startsWith('bmax://') ||
        u.startsWith('devtools://') ||
        u.startsWith('data:') ||
        u.startsWith('blob:') ||
        (DEV_URL !== null && (u.startsWith(DEV_URL) || u.startsWith(DEV_URL.replace('http', 'ws'))))
      cb({ cancel: !allowed })
    })
    this.ui_ = ses
    return ses
  }

  /** Session used by web content tabs. */
  web(partition: string, opts: { tor?: boolean } = {}): Session {
    const existing = this.entries.get(partition)
    if (existing) return existing.ses
    const tor = opts.tor ?? false
    const ses = session.fromPartition(partition)
    registerInternalProtocol(ses)
    this.deps.certs.attach(ses)
    this.deps.permissions.attach(ses, tor)
    this.deps.pipeline.install(ses, { partition, tor })
    ses.registerPreloadScript({ type: 'frame', filePath: preloadPath('web') })
    // Cosmetic filtering + scriptlet injection (asks main for rules; main decides per site whether Shields is on).
    ses.registerPreloadScript({ type: 'frame', filePath: SHIELDS_PRELOAD })
    configureSpellcheck(ses)
    ses.on('will-download', (_e, item, wc) => services.downloads.onWillDownload(item, wc))
    this.entries.set(partition, {
      ses,
      tor,
      ephemeral: partition !== PRIVATE_PARTITION,
      refs: 0,
      secret: randomBytes(16).toString('hex')
    })
    this.configure(ses, tor)
    return ses
  }

  private utility_: Session | null = null

  /** Session for the browser's own downloads (filter lists, updates): generic UA, honours the user's proxy, never Tor. */
  utility(): Session {
    if (this.utility_) return this.utility_
    const ses = session.fromPartition('bmax-updates')
    this.entries.set('bmax-updates', { ses, tor: false, ephemeral: false, refs: 1, secret: '' })
    this.configure(ses, false)
    this.utility_ = ses
    return ses
  }

  /** UA + proxy for one session according to current settings. */
  private configure(ses: Session, tor: boolean): void {
    const s = this.deps.settings.get()
    const major = Number(process.versions.chrome.split('.')[0])
    if (s.privacy.uniformUserAgent || tor) ses.setUserAgent(uniformUserAgent(major), UNIFORM_ACCEPT_LANGUAGE)
    else ses.setUserAgent(cleanUserAgent(ses.getUserAgent()))

    if (tor) {
      if (this.torSocksPort) {
        // '<-loopback>' removes Chromium's implicit "localhost bypasses the proxy" rule: nothing leaves directly.
        void ses.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${this.torSocksPort}`, proxyBypassRules: '<-loopback>' })
      } else {
        void ses.setProxy({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1', proxyBypassRules: '<-loopback>' }) // dead end until Tor is configured
      }
      return
    }
    if (s.proxy.enabled) {
      // An enabled-but-invalid proxy must fail closed (dead-end proxy), never silently go direct.
      const rules = proxyRules(s.proxy) ?? 'socks5://127.0.0.1:1'
      void ses.setProxy({ mode: 'fixed_servers', proxyRules: rules })
    } else {
      void ses.setProxy({ mode: 'direct' })
    }
  }

  /** Re-apply UA / proxy settings to every web session (after the user changes them). */
  applySettings(): void {
    for (const e of this.entries.values()) this.configure(e.ses, e.tor)
  }

  /** Create the Tor window's session with its proxy fully applied BEFORE any page can load. */
  async prepareTor(socksPort: number): Promise<string> {
    this.torSocksPort = socksPort
    const partition = `bmax-tor-${Date.now().toString(36)}-${++this.counter}`
    const ses = this.web(partition, { tor: true })
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${socksPort}`, proxyBypassRules: '<-loopback>' })
    return partition
  }

  newContainerPartition(): string {
    return `bmax-ctr-${Date.now().toString(36)}-${++this.counter}`
  }
  newIsolatedPartition(): string {
    return `bmax-iso-${Date.now().toString(36)}-${++this.counter}`
  }

  isTor(partition: string): boolean {
    return this.entries.get(partition)?.tor ?? false
  }
  /** Per-session secret used to derive per-site fingerprint-noise seeds. Never leaves the main process. */
  secret(partition: string): string {
    return this.entries.get(partition)?.secret ?? ''
  }
  /** Short, stable label for a container partition (null for the shared session). */
  containerLabel(partition: string): string | null {
    return partition === PRIVATE_PARTITION ? null : partition.slice(-6)
  }

  retain(partition: string): void {
    const e = this.entries.get(partition)
    if (e) e.refs++
  }

  /** Called when a tab closes; the last tab of an ephemeral session wipes it. */
  release(partition: string): void {
    const e = this.entries.get(partition)
    if (!e) return
    e.refs = Math.max(0, e.refs - 1)
    if (e.refs === 0 && e.ephemeral) {
      this.entries.delete(partition)
      void wipe(e.ses)
    }
  }

  /** Burn: wipe everything in every session right now. */
  async burnAll(): Promise<void> {
    const all = [...this.entries.values()].map((e) => e.ses)
    await Promise.all(all.map((s) => wipe(s)))
    this.deps.certs.clear()
  }

  all(): Session[] {
    return [...this.entries.values()].map((e) => e.ses)
  }

  partitions(): string[] {
    return [...this.entries.keys()]
  }
}
