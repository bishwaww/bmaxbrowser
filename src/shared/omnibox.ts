import { searchUrl } from './search-engines'
import { internalUrl, INTERNAL_SCHEME, NAVIGABLE_PAGES } from './internal'
import type { InternalPage } from './internal'

export type OmniboxResult = { kind: 'url'; url: string } | { kind: 'search'; url: string; query: string }

/** Schemes the user may type into the address bar and have navigated to. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'view-source:', 'about:', `${INTERNAL_SCHEME}:`])
/** Never navigate to these from typed text; they are treated as a search instead. */
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:'])

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i
const IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}(:\d+)?(\/.*)?$/
const IPV6_RE = /^\[[0-9a-f:.]+\](:\d+)?(\/.*)?$/i
const HOST_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(:\d+)?([/?#].*)?$/i
const LOCAL_RE = /^(localhost|[a-z0-9-]+\.(localhost|local|test|internal))(:\d+)?([/?#].*)?$/i

function isLocalHost(input: string): boolean {
  return LOCAL_RE.test(input) || IPV4_RE.test(input) || IPV6_RE.test(input)
}

/** Decide whether omnibox text is a URL or a search query, and build the URL to load. */
export function resolveOmnibox(raw: string, engineId: string): OmniboxResult {
  const input = raw.trim()
  const asSearch = (): OmniboxResult => ({ kind: 'search', url: searchUrl(engineId, input), query: input })
  if (!input) return { kind: 'url', url: internalUrl('newtab') }

  const scheme = SCHEME_RE.exec(input)
  // "host:8080" looks like a scheme; treat as a URL if it is localhost/IP:port style
  if (scheme && !/^[^\s/:]+:\d+([/?#]|$)/.test(input)) {
    const proto = `${scheme[1]!.toLowerCase()}:`
    if (BLOCKED_SCHEMES.has(proto)) return asSearch()
    if (ALLOWED_SCHEMES.has(proto)) {
      if (proto === `${INTERNAL_SCHEME}:`) {
        const page = input.replace(/^bmax:\/\//i, '').split(/[/?#]/)[0]!.toLowerCase() as InternalPage
        if (!NAVIGABLE_PAGES.includes(page)) return asSearch()
        let search = ''
        try {
          search = new URL(input).search
        } catch {
          /* no query */
        }
        return { kind: 'url', url: internalUrl(page, search) }
      }
      if (proto === 'about:') {
        return input.toLowerCase() === 'about:blank' ? { kind: 'url', url: 'about:blank' } : asSearch()
      }
      try {
        new URL(input)
        return { kind: 'url', url: input }
      } catch {
        return asSearch()
      }
    }
    // Unknown scheme with no spaces (mailto:, magnet:, ...) → pass through; main asks before opening externally.
    if (!/\s/.test(input) && /^(mailto|magnet|tel|sms|geo):/i.test(input)) return { kind: 'url', url: input }
    return asSearch()
  }

  if (/\s/.test(input)) return asSearch()
  if (isLocalHost(input)) return { kind: 'url', url: `http://${input}` }
  if (HOST_RE.test(input)) return { kind: 'url', url: `https://${input}` }
  return asSearch()
}

/** Text shown in the omnibox for a URL (hide the https:// prefix noise, keep it for http). */
export function displayUrl(url: string): string {
  if (url.startsWith(`${INTERNAL_SCHEME}://newtab`)) return ''
  return url.replace(/^https:\/\//, '').replace(/\/$/, '')
}
