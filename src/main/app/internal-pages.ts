import { app, net, protocol } from 'electron'
import type { Session } from 'electron'
import { existsSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { INTERNAL_PAGES, INTERNAL_SCHEME, internalUrl, parseInternalUrl } from '@shared/internal'
import type { InternalPage } from '@shared/internal'

/** Vite dev server origin; only ever trusted when the app is not packaged. */
export const DEV_URL: string | null = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null
const RENDERER_ROOT = resolve(join(__dirname, '../renderer'))

/** Per-page CSP: only the torrent manager may play media, and only from the loopback streaming server. */
export function cspFor(page: InternalPage): string {
  return page === 'torrents' ? `${CSP}; media-src http://127.0.0.1:*` : CSP
}

export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8'
}

/** Must be called before app 'ready'. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** Turn a logical bmax:// URL into the URL that is actually loaded (dev server in development). */
export function resolveLoadUrl(url: string): string {
  const parsed = parseInternalUrl(url)
  if (!parsed || !DEV_URL) return url
  return `${DEV_URL}/${parsed.page}/index.html${parsed.search}`
}

/** Inverse of resolveLoadUrl: map a dev-server URL back to its bmax:// form so the UI never shows localhost. */
export function toLogicalUrl(url: string): string {
  if (!DEV_URL || !url.startsWith(DEV_URL)) return url
  try {
    const u = new URL(url)
    const page = u.pathname.split('/')[1] as InternalPage
    return INTERNAL_PAGES.includes(page) ? internalUrl(page, u.search) : url
  } catch {
    return url
  }
}

export function isTrustedInternalUrl(url: string): boolean {
  if (parseInternalUrl(url)) return true
  return DEV_URL !== null && url.startsWith(`${DEV_URL}/`) && parseInternalUrl(toLogicalUrl(url)) !== null
}

/** Logical page of a (possibly dev-server) URL, or null. */
export function internalPageOf(url: string): InternalPage | null {
  return parseInternalUrl(toLogicalUrl(url))?.page ?? null
}

function secureHeaders(contentType: string, page: InternalPage): Headers {
  const h = new Headers()
  h.set('content-type', contentType)
  h.set('content-security-policy', cspFor(page))
  h.set('x-content-type-options', 'nosniff')
  h.set('cache-control', 'no-store')
  h.set('referrer-policy', 'no-referrer')
  return h
}

/** Serve bmax:// pages from out/renderer. Sessions each have their own protocol registry. */
export function registerInternalProtocol(ses: Session): void {
  ses.protocol.handle(INTERNAL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const page = url.hostname as InternalPage
      if (!INTERNAL_PAGES.includes(page)) return new Response('Not found', { status: 404 })
      let rel = decodeURIComponent(url.pathname)
      if (rel === '/' || rel === '') rel = `/${page}/index.html`
      else if (!rel.startsWith('/assets/')) rel = `/${page}${rel}`
      const file = resolve(join(RENDERER_ROOT, rel))
      if (!file.startsWith(RENDERER_ROOT + sep) || !existsSync(file)) {
        return new Response('Not found', { status: 404 })
      }
      const upstream = await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true })
      return new Response(upstream.body, {
        status: 200,
        headers: secureHeaders(MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', page)
      })
    } catch {
      return new Response('Internal error', { status: 500 })
    }
  })
}
