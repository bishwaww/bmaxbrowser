import { session } from 'electron'
import type { Session } from 'electron'
import { registerInternalProtocol, DEV_URL } from '../app/internal-pages'
import { preloadPath } from '../app/paths'
import { configureSpellcheck } from '../privacy/spellcheck'
import type { CertCache } from '../net/cert-cache'
import type { RequestPipeline } from '../net/RequestPipeline'
import type { PermissionManager } from '../permissions/PermissionManager'

/** No "persist:" prefix → memory-only partitions: no cookies/cache/localStorage/IndexedDB ever written to disk. */
export const PRIVATE_PARTITION = 'bmax-private'
export const UI_PARTITION = 'bmax-ui'

/** Strip the Electron / app tokens from the UA so sites see a plain Chrome. (Uniform UA + client hints: Phase 2.) */
export function cleanUserAgent(ua: string): string {
  return ua.replace(/\s(Electron|bmax-browser|BMAX\s?Browser)\/\S+/gi, '')
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private isolatedCounter = 0

  constructor(
    private deps: { pipeline: RequestPipeline; permissions: PermissionManager; certs: CertCache }
  ) {}

  /** Session for browser UI (chrome, overlays): internal pages only, all network blocked. */
  ui(): Session {
    const existing = this.sessions.get(UI_PARTITION)
    if (existing) return existing
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
    this.sessions.set(UI_PARTITION, ses)
    return ses
  }

  /** Session used by web content tabs. */
  web(partition: string): Session {
    const existing = this.sessions.get(partition)
    if (existing) return existing
    const ses = session.fromPartition(partition)
    registerInternalProtocol(ses)
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()))
    this.deps.certs.attach(ses)
    this.deps.permissions.attach(ses)
    this.deps.pipeline.install(ses, { partition })
    ses.registerPreloadScript({ type: 'frame', filePath: preloadPath('web') })
    configureSpellcheck(ses)
    this.sessions.set(partition, ses)
    return ses
  }

  newIsolatedPartition(): string {
    return `bmax-iso-${Date.now().toString(36)}-${++this.isolatedCounter}`
  }

  all(): Session[] {
    return [...this.sessions.values()]
  }

  partitions(): string[] {
    return [...this.sessions.keys()]
  }
}
