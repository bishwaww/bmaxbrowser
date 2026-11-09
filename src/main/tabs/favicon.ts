import type { Session } from 'electron'

const cache = new Map<string, string>()
const MAX_ENTRIES = 300
const MAX_BYTES = 256 * 1024

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
    const type = res.headers.get('content-type') ?? ''
    if (!/^image\//i.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) return null
    const dataUrl = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`
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

export function clearFaviconCache(): void {
  cache.clear()
}
