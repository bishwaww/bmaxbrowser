export interface VaultStatus {
  /** OS keystore usable (false e.g. on Linux without a keyring). */
  available: boolean
  exists: boolean
  unlocked: boolean
}

export interface Bookmark {
  id: string
  title: string
  url: string
  folder: string
  added: number
  /** Small favicon (data: URL) captured when the page was bookmarked. */
  icon?: string | undefined
}

export interface PasswordEntry {
  id: string
  site: string
  username: string
  updated: number
}
