export type SecurityLevel = 'internal' | 'secure' | 'insecure' | 'error' | 'file' | 'none'
export type OverlayKind = 'menu' | 'cert' | 'permission' | 'find' | 'suggest'
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
  /** Resolved light/dark for the UI. */
  theme: 'light' | 'dark'
  showHomeButton: boolean
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
}
