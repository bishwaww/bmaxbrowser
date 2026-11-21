export type SecurityLevel = 'internal' | 'secure' | 'insecure' | 'error' | 'file' | 'none'
export type OverlayKind = 'menu' | 'cert' | 'permission' | 'find' | 'suggest' | 'shields' | 'media'
export type Platform = 'win32' | 'darwin' | 'linux'

export interface TabInfo {
  id: number
  title: string
  url: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  muted: boolean
  audible: boolean
  security: SecurityLevel
  isNewTab: boolean
  /** Background tab whose page was unloaded to free memory; reloads when selected. */
  sleeping: boolean
  /** Short id of the tab's container (isolated session), or null for the shared private session. */
  container: string | null
  /** Current URL is in the (unlocked) bookmarks vault. */
  bookmarked: boolean
  /** Shields state for this tab: site toggle and number of items blocked on the current page. */
  shields: { enabled: boolean; blocked: number }
  /** Media found on the page (drives the address-bar download button). */
  media: { videos: number; audios: number; images: number; sniffed: number }
}

export interface WindowState {
  windowId: number
  platform: Platform
  tabs: TabInfo[]
  activeTabId: number | null
  fullscreen: boolean
  /** 0..1 progress of the active tab; 0 when idle. */
  progress: number
  zoomPercent: number
  /** Window uses its own isolated session (Ctrl+Shift+N). */
  isolated: boolean
  /** Resolved theme for the UI ('tor' = purple Tor window). */
  theme: 'light' | 'dark' | 'tor'
  showHomeButton: boolean
  /** Chrome-style bookmarks bar under the toolbar. */
  showBookmarksBar: boolean
  /** Tor window: purple theme, strict settings, fail-closed networking. */
  tor: boolean
  /** Extension window: the only kind of window that runs extensions (its own temporary on-disk profile). */
  extensions: boolean
}

export interface CertInfo {
  hostname: string
  secure: boolean
  subject: string
  issuer: string
  validFrom: number
  validTo: number
  fingerprint: string
  serialNumber: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PermissionPromptData {
  requestId: number
  origin: string
  permission: string
  label: string
}

export interface SuggestionItem {
  kind: 'search' | 'url' | 'tab'
  text: string
  url: string
  tabId?: number
  /** Site icon (data: URL) when known. */
  icon?: string | null
}

export interface TorState {
  status: 'stopped' | 'starting' | 'ready' | 'failed' | 'missing'
  /** Bootstrap progress 0..100. */
  progress: number
  summary: string
  error?: string | undefined
}
