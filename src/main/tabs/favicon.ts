import { nativeImage } from 'electron'
import type { Session } from 'electron'

const cache = new Map<string, string>()
const MAX_ENTRIES = 300
const MAX_BYTES = 256 * 1024
/** Icons bigger than this are scaled down to 32 px when Chromium can decode them (keeps UI state messages small). */
const SHRINK_ABOVE = 12 * 1024

/** Site icon by host, learned from open tabs. Memory only (cleared by Burn); used for bookmarks, shortcuts and suggestions. */
const byHost = new Map<string, string>()
const MAX_HOSTS = 400
/** Longest icon (data: URL length) kept per host or saved with a bookmark. */
export const MAX_SITE_ICON = 100_000

/** Some servers send icons as application/octet-stream or without a type: recognise the common formats by their first bytes. */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 4) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  const head = buf.toString('utf8', 0, Math.min(buf.length, 300)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml'
  return null
}

/**
 * Fetch a favicon through the TAB's session (so proxy / Tor / request pipeline all apply) and return a data URL.
 * The browser UI never loads remote images itself (its CSP is img-src data:).
 */
export async function fetchFavicon(ses: Session, url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url.length < MAX_BYTES ? url : null
  if (!/^https?:\/\//i.test(url)) return null
  const hit = cache.get(url)
  if (hit) return hit
  try {
    const res = await ses.fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' } as RequestInit)
    if (!res.ok) return null
    let buf: Buffer = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) return null
    const declared = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    let type = /^image\//.test(declared) ? declared : sniffImageType(buf)
    if (!type) return null
    if (buf.length > SHRINK_ABOVE && type !== 'image/svg+xml') {
      try {
        const img = nativeImage.createFromBuffer(buf)
        if (!img.isEmpty()) {
          buf = img.resize({ width: 32, height: 32, quality: 'best' }).toPNG()
          type = 'image/png'
        }
      } catch {
        /* keep the original bytes */
      }
    }
    const dataUrl = `data:${type};base64,${buf.toString('base64')}`
    cache.set(url, dataUrl)
    if (cache.size > MAX_ENTRIES) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
    return dataUrl
  } catch {
    return null
  }
}

/** Host of a web address without "www." ('' for anything that is not http/https). */
export function siteHost(pageUrl: string): string {
  try {
    const u = new URL(pageUrl)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

export function rememberSiteIcon(pageUrl: string, dataUrl: string): void {
  const host = siteHost(pageUrl)
  if (!host || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_SITE_ICON) return
  byHost.delete(host)
  byHost.set(host, dataUrl)
  if (byHost.size > MAX_HOSTS) {
    const first = byHost.keys().next().value
    if (first !== undefined) byHost.delete(first)
  }
}

export function siteIcon(pageUrl: string): string | null {
  const host = siteHost(pageUrl)
  return host ? (byHost.get(host) ?? null) : null
}

export function clearFaviconCache(): void {
  cache.clear()
  byHost.clear()
}
