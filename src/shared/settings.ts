import { z } from 'zod'
import { DEFAULT_SEARCH_ENGINE_ID, SEARCH_ENGINES } from './search-engines'
import { NEWTAB_URL } from './internal'

export const tileSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(80),
  url: z.string().max(2048)
})
export type Tile = z.infer<typeof tileSchema>

const dohSchema = z.object({
  mode: z.enum(['secure', 'off']),
  provider: z.enum(['quad9', 'cloudflare', 'mullvad', 'nextdns', 'custom']),
  customUrl: z.string().max(512)
})

const privacySchema = z.object({
  httpsOnly: z.boolean(),
  stripTrackingParams: z.boolean(),
  blockThirdPartyCookies: z.boolean(),
  fingerprintProtection: z.boolean(),
  sendGpc: z.boolean(),
  uniformUserAgent: z.boolean(),
  /**
   * Keep cookies and site data of normal windows after BMAX closes (stay signed in), like an ordinary browser.
   * OFF by default: normal windows are memory-only. Applies from the next start. Never applies to Tor/isolated/container tabs.
   */
  keepSiteData: z.boolean().default(false),
  doh: dohSchema
})

const proxySchema = z.object({
  enabled: z.boolean(),
  scheme: z.enum(['socks5', 'http', 'https']),
  host: z.string().max(253),
  port: z.number().int().min(0).max(65535)
})

const shieldsSchema = z.object({
  enabled: z.boolean(),
  /** Per-list on/off overrides (absent = the list's default). */
  lists: z.record(z.string().max(64), z.boolean()),
  autoUpdate: z.boolean(),
  blockPopups: z.boolean(),
  blockRedirects: z.boolean(),
  blockNotifications: z.boolean(),
  youtube: z.boolean(),
  /** Registrable domains where the user turned Shields off. */
  disabledSites: z.array(z.string().max(253)).max(500)
})

const downloadsSchema = z.object({
  /** Absolute folder; empty = the system Downloads folder. */
  folder: z.string().max(1024),
  askWhere: z.boolean(),
  autoUpdateYtdlp: z.boolean(),
  maxConcurrent: z.number().int().min(1).max(8)
})

const torrentsSchema = z.object({
  /** Absolute folder; empty = Downloads/Torrents. */
  folder: z.string().max(1024),
  /** KiB/s, 0 = unlimited */
  downKBps: z.number().int().min(0).max(10_000_000),
  upKBps: z.number().int().min(0).max(10_000_000),
  maxConnections: z.number().int().min(5).max(1000),
  stopSeedingWhenDone: z.boolean(),
  /** Show the file list and wait for the user's choice before downloading. */
  askFiles: z.boolean(),
  dht: z.boolean(),
  /** Local-network peer discovery (announces on the LAN). */
  lsd: z.boolean(),
  /** Ask the router to open a port (UPnP / NAT-PMP). */
  upnp: z.boolean()
})

const generalSchema = z.object({
  /** Reopen last session's tabs (only addresses are stored, in session.json). Off by default; never for Tor/isolated windows or containers. */
  restoreSession: z.boolean(),
  /** Minutes before a background tab is put to sleep (memory freed); 0 = never. */
  sleepTabsAfterMin: z.number().int().min(0).max(1440),
  /** Check GitHub Releases for a new version (about once a day). The only network traffic of the updater. */
  checkUpdates: z.boolean()
})

const readerSchema = z.object({
  font: z.enum(['serif', 'sans']),
  /** px */
  size: z.number().int().min(12).max(32),
  theme: z.enum(['auto', 'light', 'sepia', 'dark'])
})

export const settingsSchema = z.object({
  searchEngine: z.enum(SEARCH_ENGINES.map((e) => e.id) as [string, ...string[]]),
  theme: z.enum(['system', 'light', 'dark']),
  /** prefers-color-scheme reported to websites: follow the app theme, or force one (Tor windows always report light). */
  siteColorScheme: z.enum(['follow', 'light', 'dark']),
  homepage: z.string().max(2048),
  showHomeButton: z.boolean(),
  showBookmarksBar: z.boolean(),
  tiles: z.array(tileSchema).max(24),
  privacy: privacySchema,
  shields: shieldsSchema,
  downloads: downloadsSchema,
  torrents: torrentsSchema,
  proxy: proxySchema,
  general: generalSchema,
  reader: readerSchema,
  permissions: z.object({
    /** What to do when a site asks and there is no stored decision. */
    defaultAction: z.enum(['ask', 'deny']),
    /** Persist per-site decisions to disk (off: decisions live in memory until the app closes). */
    persist: z.boolean()
  })
})
export type Settings = z.infer<typeof settingsSchema>
export const settingsPatchSchema = settingsSchema.partial()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: DEFAULT_SEARCH_ENGINE_ID,
  theme: 'system',
  siteColorScheme: 'follow',
  homepage: NEWTAB_URL,
  showHomeButton: true,
  showBookmarksBar: true,
  tiles: [
    { id: 'ddg', title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
    { id: 'wikipedia', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
    { id: 'github', title: 'GitHub', url: 'https://github.com/' },
    { id: 'osm', title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/' }
  ],
  privacy: {
    httpsOnly: true,
    stripTrackingParams: true,
    blockThirdPartyCookies: true,
    fingerprintProtection: true,
    sendGpc: true,
    uniformUserAgent: true,
    keepSiteData: false,
    doh: { mode: 'secure', provider: 'quad9', customUrl: '' }
  },
  shields: {
    enabled: true,
    lists: {},
    autoUpdate: true,
    blockPopups: true,
    blockRedirects: true,
    blockNotifications: true,
    youtube: true,
    disabledSites: []
  },
  downloads: { folder: '', askWhere: false, autoUpdateYtdlp: true, maxConcurrent: 3 },
  torrents: { folder: '', downKBps: 0, upKBps: 0, maxConnections: 55, stopSeedingWhenDone: false, askFiles: true, dht: true, lsd: false, upnp: false },
  proxy: { enabled: false, scheme: 'socks5', host: '127.0.0.1', port: 1080 },
  general: { restoreSession: false, sleepTabsAfterMin: 15, checkUpdates: true },
  reader: { font: 'serif', size: 19, theme: 'auto' },
  permissions: { defaultAction: 'ask', persist: false }
}

export interface PrivacyStats {
  adsBlocked: number
  trackersBlocked: number
  /** Estimated milliseconds saved by not loading blocked resources. */
  timeSavedMs: number
}
