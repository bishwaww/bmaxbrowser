import type { PipelineContext, RequestPipeline } from './RequestPipeline'
import {
  isLocalHost,
  isOnion,
  isThirdParty,
  stripTrackingParams,
  trimReferrer,
  uniformClientHints,
  UNIFORM_ACCEPT_LANGUAGE
} from '@shared/privacy'
import { services } from '../services'

/** Hosts for which the user chose "continue over HTTP". Key: `${partition}|${host}`. Memory only. */
const httpExceptions = new Set<string>()
/** Main-frame navigations we upgraded, so the tab can show the HTTPS-only warning if the upgrade fails. */
export const upgradedNavigations = new Map<number, { from: string; to: string }>()

export function allowHttp(partition: string, host: string): void {
  httpExceptions.add(`${partition}|${host.toLowerCase()}`)
}
export function clearPrivacyExceptions(): void {
  httpExceptions.clear()
  upgradedNavigations.clear()
}

const CLIENT_HINT_PREFIXES = ['sec-ch-', 'device-memory', 'dpr', 'viewport-width', 'width', 'downlink', 'ect', 'rtt', 'save-data']

function deleteHeader(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) delete headers[k]
}
function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return headers[k]
  return undefined
}
function setHeader(headers: Record<string, string>, name: string, value: string): void {
  deleteHeader(headers, name)
  headers[name] = value
}

function topUrlOf(d: { webContents?: Electron.WebContents | null; resourceType: string }): string | null {
  if (d.resourceType === 'mainFrame') return null // top-level navigation is first-party by definition
  const wc = d.webContents
  if (!wc || wc.isDestroyed()) return null
  return wc.getURL() || null
}

const ALWAYS_ALLOWED_SCHEMES = /^(bmax|devtools|data|blob|file|about|chrome-extension|view-source):/i

export function registerPrivacyHandlers(pipeline: RequestPipeline): void {
  const settings = (): ReturnType<typeof services.settings.get> => services.settings.get()

  // ------------------------------------------------------------------ 1. Tor gate: fail closed
  pipeline.onBeforeRequest('tor-gate', (d, ctx: PipelineContext) => {
    if (!ctx.tor) return
    if (ALWAYS_ALLOWED_SCHEMES.test(d.url)) return
    if (!services.tor.isReady()) return { cancel: true }
    try {
      const u = new URL(d.url)
      // Tor windows never talk to the local network, even through Tor.
      if (isLocalHost(u.hostname)) return { cancel: true }
    } catch {
      return { cancel: true }
    }
  })

  // ------------------------------------------------------------------ 2. strip tracking parameters (top-level GET navigations)
  pipeline.onBeforeRequest('tracking-params', (d) => {
    if (!settings().privacy.stripTrackingParams) return
    if (d.resourceType !== 'mainFrame' || d.method !== 'GET') return
    const cleaned = stripTrackingParams(d.url)
    if (cleaned !== d.url) return { redirectURL: cleaned }
  })

  // ------------------------------------------------------------------ 3. HTTPS-Only
  pipeline.onBeforeRequest('https-only', (d, ctx) => {
    if (!settings().privacy.httpsOnly && !ctx.tor) return
    if (!d.url.startsWith('http://')) return
    let u: URL
    try {
      u = new URL(d.url)
    } catch {
      return
    }
    if (isLocalHost(u.hostname) || isOnion(u.hostname)) return
    if (httpExceptions.has(`${ctx.partition}|${u.hostname.toLowerCase()}`)) return
    u.protocol = 'https:'
    const to = u.toString()
    if (d.resourceType === 'mainFrame' && d.webContents) upgradedNavigations.set(d.webContents.id, { from: d.url, to })
    return { redirectURL: to }
  })

  // ------------------------------------------------------------------ 4. block pings (hyperlink auditing, third-party beacons)
  pipeline.onBeforeRequest('block-pings', (d, ctx) => {
    if (d.resourceType !== 'ping') return
    const top = topUrlOf(d)
    if (ctx.tor || !top || isThirdParty(top, d.url)) return { cancel: true }
  })

  // ------------------------------------------------------------------ request headers
  pipeline.onBeforeSendHeaders('privacy-headers', (d, headers, ctx) => {
    const s = settings().privacy
    const top = topUrlOf(d)
    const thirdParty = top !== null && isThirdParty(top, d.url)

    if (s.uniformUserAgent || ctx.tor) {
      for (const k of Object.keys(headers)) {
        const lower = k.toLowerCase()
        if (CLIENT_HINT_PREFIXES.some((p) => lower === p || lower.startsWith(p))) delete headers[k]
      }
      const major = Number(process.versions.chrome.split('.')[0])
      for (const [k, v] of Object.entries(uniformClientHints(major))) setHeader(headers, k, v)
      setHeader(headers, 'Accept-Language', UNIFORM_ACCEPT_LANGUAGE)
    }

    deleteHeader(headers, 'DNT')
    if (s.sendGpc || ctx.tor) setHeader(headers, 'Sec-GPC', '1')

    const referer = getHeader(headers, 'Referer')
    if (referer) {
      const trimmed = trimReferrer(referer, d.url, ctx.tor)
      if (trimmed === null) deleteHeader(headers, 'Referer')
      else setHeader(headers, 'Referer', trimmed)
    }

    if ((s.blockThirdPartyCookies || ctx.tor) && thirdParty) deleteHeader(headers, 'Cookie')
  })

  // ------------------------------------------------------------------ response headers
  pipeline.onHeadersReceived('privacy-response-headers', (d, headers, ctx) => {
    const s = settings().privacy
    // Do not let servers ask for (or demand) high-entropy client hints.
    for (const k of Object.keys(headers)) {
      const lower = k.toLowerCase()
      if (lower === 'accept-ch' || lower === 'critical-ch' || lower === 'permissions-policy-report-only') delete headers[k]
    }
    if (!(s.blockThirdPartyCookies || ctx.tor)) return
    const top = topUrlOf(d)
    if (top !== null && isThirdParty(top, d.url)) {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k]
    }
  })
}
