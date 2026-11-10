/** Chrome-extension helpers shared by main and the settings UI. Pure: no Electron imports. */

export interface ExtensionInfo {
  /** Chromium extension id (stable: derived from the install folder). */
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  manifestVersion: number
  /** Plain-language summary of what it may access. */
  permissions: string[]
  /** True when it can read/change every website. */
  allSites: boolean
  /** Extension page to open in a tab (options page / popup), if the manifest has one. */
  optionsPage: string | null
  popupPage: string | null
  /** Why it is not running (load error), if any. */
  error?: string | undefined
}

const PERMISSION_LABELS: Record<string, string> = {
  activeTab: 'Access the page you are on when you use the extension',
  alarms: 'Run scheduled tasks',
  bookmarks: 'Read and change bookmarks',
  browsingData: 'Clear browsing data',
  clipboardRead: 'Read the clipboard',
  clipboardWrite: 'Write to the clipboard',
  contextMenus: 'Add context-menu items',
  cookies: 'Read and change cookies',
  declarativeNetRequest: 'Block or change network requests',
  declarativeNetRequestWithHostAccess: 'Block or change network requests on allowed sites',
  downloads: 'Manage downloads',
  history: 'Read browsing history',
  identity: 'Sign you in with an account',
  management: 'Manage other extensions',
  nativeMessaging: 'Talk to programs on your computer',
  notifications: 'Show notifications',
  offscreen: 'Create hidden pages',
  scripting: 'Inject scripts into pages it can access',
  storage: 'Store its own data',
  tabs: 'Read the address and title of your tabs',
  topSites: 'Read your most visited sites',
  unlimitedStorage: 'Store unlimited data',
  webNavigation: 'Watch page navigations',
  webRequest: 'Observe network requests',
  webRequestBlocking: 'Block or change network requests'
}

const ALL_SITES = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|file:\/\/\/\*)$/

export interface ManifestSummary {
  name: string
  version: string
  description: string
  manifestVersion: number
  permissions: string[]
  allSites: boolean
  hosts: string[]
  optionsPage: string | null
  popupPage: string | null
}

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : [])
const rel = (v: unknown): string | null => {
  const s = str(v, 300).replace(/^\/+/, '')
  return s && !s.includes('..') && !/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : null
}

/** Read the parts of a manifest we show to the user before installing. Throws on an unusable manifest. */
export function summarizeManifest(raw: unknown): ManifestSummary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('manifest.json is not an object')
  const m = raw as Record<string, unknown>
  const manifestVersion = Number(m['manifest_version'])
  if (manifestVersion !== 2 && manifestVersion !== 3) throw new Error('Unsupported manifest_version (expected 2 or 3)')
  const name = str(m['name'], 120)
  if (!name) throw new Error('The extension has no name')
  const version = str(m['version'], 40) || '0'
  const content = Array.isArray(m['content_scripts']) ? (m['content_scripts'] as Record<string, unknown>[]) : []
  const hosts = new Set<string>([...strs(m['host_permissions']), ...strs(m['permissions']).filter((p) => p.includes('/') || p === '<all_urls>')])
  for (const cs of content) for (const match of strs(cs?.['matches'])) hosts.add(match)
  const perms = strs(m['permissions']).filter((p) => !(p.includes('/') || p === '<all_urls>'))
  const allSites = [...hosts].some((h) => ALL_SITES.test(h))
  const labels = perms.map((p) => PERMISSION_LABELS[p] ?? `Use the "${p.slice(0, 60)}" permission`)
  if (allSites) labels.unshift('Read and change your data on ALL websites')
  else if (hosts.size) labels.unshift(`Read and change your data on: ${[...hosts].slice(0, 8).join(', ')}${hosts.size > 8 ? `, and ${hosts.size - 8} more` : ''}`)
  const action = (m['action'] ?? m['browser_action']) as Record<string, unknown> | undefined
  const opts = m['options_ui'] as Record<string, unknown> | undefined
  return {
    name,
    version,
    description: str(m['description'], 300),
    manifestVersion,
    permissions: labels,
    allSites,
    hosts: [...hosts],
    optionsPage: rel(opts?.['page']) ?? rel(m['options_page']),
    popupPage: rel(action?.['default_popup'])
  }
}
