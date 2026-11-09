import { describe, expect, it } from 'vitest'
import {
  dohServers,
  isLocalHost,
  isThirdParty,
  isTrackingParam,
  proxyRules,
  siteOf,
  stripTrackingParams,
  trimReferrer,
  uniformClientHints,
  uniformUserAgent
} from '@shared/privacy'

describe('stripTrackingParams', () => {
  it('removes utm_*, fbclid, gclid, mc_eid, igshid and friends', () => {
    expect(stripTrackingParams('https://a.com/p?utm_source=x&utm_medium=y&id=5')).toBe('https://a.com/p?id=5')
    expect(stripTrackingParams('https://a.com/?fbclid=abc')).toBe('https://a.com/')
    expect(stripTrackingParams('https://a.com/?gclid=1&q=cats&mc_eid=2&igshid=3')).toBe('https://a.com/?q=cats')
    expect(stripTrackingParams('https://a.com/?UTM_Campaign=x')).toBe('https://a.com/')
  })
  it('keeps unrelated parameters, fragments and untouched URLs byte-for-byte', () => {
    const u = 'https://a.com/p?q=hello%20world&page=2#frag'
    expect(stripTrackingParams(u)).toBe(u)
    expect(stripTrackingParams('https://a.com/p?x=1&utm_source=z#frag')).toBe('https://a.com/p?x=1#frag')
  })
  it('ignores non-http URLs and garbage', () => {
    expect(stripTrackingParams('bmax://newtab/?utm_source=x')).toBe('bmax://newtab/?utm_source=x')
    expect(stripTrackingParams('not a url')).toBe('not a url')
  })
  it('isTrackingParam is case-insensitive and prefix-aware', () => {
    expect(isTrackingParam('utm_anything')).toBe(true)
    expect(isTrackingParam('FBCLID')).toBe(true)
    expect(isTrackingParam('q')).toBe(false)
    expect(isTrackingParam('utmx')).toBe(false)
  })
})

describe('isLocalHost', () => {
  it('recognises loopback, LAN and local names', () => {
    for (const h of ['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.1', '169.254.1.1', 'printer.local', '::1', '[::1]'])
      expect(isLocalHost(h), h).toBe(true)
  })
  it('rejects public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1', 'localhost.example.com'])
      expect(isLocalHost(h), h).toBe(false)
  })
})

describe('third-party detection', () => {
  it('uses the registrable domain', () => {
    expect(siteOf('www.example.co.uk')).toBe('example.co.uk')
    expect(isThirdParty('https://www.a.com/', 'https://cdn.a.com/x.js')).toBe(false)
    expect(isThirdParty('https://a.com/', 'https://tracker.net/p')).toBe(true)
    expect(isThirdParty('https://a.co.uk/', 'https://b.co.uk/')).toBe(true)
  })
  it('treats IPs/localhost per host', () => {
    expect(isThirdParty('http://127.0.0.1:1/', 'http://localhost:1/')).toBe(true)
    expect(isThirdParty('http://127.0.0.1:1/', 'http://127.0.0.1:2/')).toBe(false)
  })
})

describe('trimReferrer', () => {
  it('keeps same-site, trims cross-site to origin, never downgrades', () => {
    expect(trimReferrer('https://a.com/secret?x=1', 'https://www.a.com/y')).toBe('https://a.com/secret?x=1')
    expect(trimReferrer('https://a.com/secret?x=1', 'https://b.com/y')).toBe('https://a.com/')
    expect(trimReferrer('https://a.com/secret', 'http://b.com/y')).toBeNull()
    expect(trimReferrer('https://a.com/secret', 'https://b.com/', true)).toBeNull()
  })
})

describe('uniform user agent / client hints', () => {
  it('contains no Electron or app tokens and only the major version', () => {
    const ua = uniformUserAgent(140)
    expect(ua).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
    expect(ua).not.toMatch(/Electron|bmax/i)
    const h = uniformClientHints(140)
    expect(h['sec-ch-ua-platform']).toBe('"Windows"')
    expect(h['sec-ch-ua']).toContain('v="140"')
  })
})

describe('DoH servers', () => {
  it('maps providers to endpoints', () => {
    expect(dohServers({ mode: 'secure', provider: 'quad9', customUrl: '' })).toEqual(['https://dns.quad9.net/dns-query'])
    expect(dohServers({ mode: 'secure', provider: 'cloudflare', customUrl: '' })).toEqual(['https://cloudflare-dns.com/dns-query'])
    expect(dohServers({ mode: 'secure', provider: 'mullvad', customUrl: '' })).toEqual(['https://dns.mullvad.net/dns-query'])
  })
  it('NextDNS needs a valid profile id, custom needs an https URL', () => {
    expect(dohServers({ mode: 'secure', provider: 'nextdns', customUrl: 'abc123' })).toEqual(['https://dns.nextdns.io/abc123'])
    expect(dohServers({ mode: 'secure', provider: 'nextdns', customUrl: '../evil' })).toEqual([])
    expect(dohServers({ mode: 'secure', provider: 'custom', customUrl: 'https://dns.example/dns-query' })).toEqual(['https://dns.example/dns-query'])
    expect(dohServers({ mode: 'secure', provider: 'custom', customUrl: 'http://dns.example/dns-query' })).toEqual([])
    expect(dohServers({ mode: 'secure', provider: 'custom', customUrl: '' })).toEqual([])
  })
})

describe('proxyRules', () => {
  it('builds Chromium proxy rules only for valid input', () => {
    expect(proxyRules({ enabled: true, scheme: 'socks5', host: '127.0.0.1', port: 1080 })).toBe('socks5://127.0.0.1:1080')
    expect(proxyRules({ enabled: true, scheme: 'http', host: 'proxy.example.com', port: 8080 })).toBe('http://proxy.example.com:8080')
    expect(proxyRules({ enabled: false, scheme: 'http', host: 'x.com', port: 1 })).toBeNull()
    expect(proxyRules({ enabled: true, scheme: 'http', host: 'bad host;rm', port: 1 })).toBeNull()
    expect(proxyRules({ enabled: true, scheme: 'http', host: 'x.com', port: 0 })).toBeNull()
    expect(proxyRules({ enabled: true, scheme: 'http', host: 'x.com', port: 70000 })).toBeNull()
  })
})
