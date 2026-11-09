import { getDomain } from 'tldts'

/** Query parameters that only exist to track you across sites. Matched case-insensitively. */
const TRACKING_EXACT = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_eid',
  'mc_cid',
  'igshid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'mkt_tok',
  'vero_id',
  'vero_conv',
  '_hsenc',
  '_hsmi',
  '__hssc',
  '__hstc',
  '__hsfp',
  'hsctatracking',
  'oly_enc_id',
  'oly_anon_id',
  'rb_clickid',
  's_cid',
  'ml_subscriber',
  'ml_subscriber_hash',
  'spm',
  '_openstat',
  'wickedid',
  'epik',
  'sc_cid',
  'ref_src',
  'ref_url'
])
const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'matomo_', 'hsa_', 'itm_']

export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase()
  return TRACKING_EXACT.has(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p))
}

/** Remove tracking parameters from an http(s) URL. Returns the same string when nothing was removed. */
export function stripTrackingParams(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url
  if (!u.search) return url
  let changed = false
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingParam(key)) {
      u.searchParams.delete(key)
      changed = true
    }
  }
  return changed ? u.toString() : url
}

/** Hosts that never need HTTPS upgrades or anonymity treatment: loopback, LAN and local names. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.test')) return true
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return h.includes(':')
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
}

export function isOnion(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.onion')
}

/** Registrable domain ("site") of a hostname; falls back to the hostname for IPs / localhost. */
export function siteOf(hostname: string): string {
  return getDomain(hostname) ?? hostname.toLowerCase()
}

export function isThirdParty(topUrl: string, requestUrl: string): boolean {
  try {
    const top = new URL(topUrl)
    const req = new URL(requestUrl)
    if (top.protocol !== 'http:' && top.protocol !== 'https:') return false
    return siteOf(top.hostname) !== siteOf(req.hostname)
  } catch {
    return false
  }
}

/** Referrer trimming: same-site keeps the header, cross-site is reduced to the origin (or removed in strict mode). */
export function trimReferrer(referrer: string, requestUrl: string, strict = false): string | null {
  try {
    const ref = new URL(referrer)
    const req = new URL(requestUrl)
    if (ref.protocol === 'https:' && req.protocol === 'http:') return null // never downgrade
    if (siteOf(ref.hostname) === siteOf(req.hostname)) return referrer
    return strict ? null : `${ref.origin}/`
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------------- user agent / client hints

export function uniformUserAgent(chromeMajor: number): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
}

export function uniformClientHints(chromeMajor: number): Record<string, string> {
  return {
    'sec-ch-ua': `"Chromium";v="${chromeMajor}", "Not-A.Brand";v="24", "Google Chrome";v="${chromeMajor}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
  }
}

export const UNIFORM_ACCEPT_LANGUAGE = 'en-US,en;q=0.9'

// ----------------------------------------------------------------------------- DNS over HTTPS

export const DOH_PROVIDERS = {
  quad9: { name: 'Quad9', url: 'https://dns.quad9.net/dns-query' },
  cloudflare: { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  mullvad: { name: 'Mullvad', url: 'https://dns.mullvad.net/dns-query' },
  nextdns: { name: 'NextDNS (custom profile)', url: 'https://dns.nextdns.io/' },
  custom: { name: 'Custom server', url: '' }
} as const
export type DohProviderId = keyof typeof DOH_PROVIDERS

export interface DohSettings {
  mode: 'secure' | 'off'
  provider: DohProviderId
  /** NextDNS profile id, or a full DoH URL for "custom". */
  customUrl: string
}

/** Resolve DoH settings to the server list for app.configureHostResolver. Empty list = invalid configuration. */
export function dohServers(doh: DohSettings): string[] {
  if (doh.provider === 'nextdns') {
    const id = doh.customUrl.trim()
    return /^[a-z0-9]{4,32}$/i.test(id) ? [`${DOH_PROVIDERS.nextdns.url}${id}`] : []
  }
  if (doh.provider === 'custom') {
    try {
      const u = new URL(doh.customUrl.trim())
      return u.protocol === 'https:' ? [u.toString()] : []
    } catch {
      return []
    }
  }
  return [DOH_PROVIDERS[doh.provider].url]
}

// ----------------------------------------------------------------------------- proxy

export interface ProxySettings {
  enabled: boolean
  scheme: 'socks5' | 'http' | 'https'
  host: string
  port: number
}

export function proxyRules(p: ProxySettings): string | null {
  if (!p.enabled) return null
  if (!/^[a-z0-9.-]+$/i.test(p.host) && !/^\[[0-9a-f:]+\]$/i.test(p.host)) return null
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) return null
  return `${p.scheme}://${p.host}:${p.port}`
}
