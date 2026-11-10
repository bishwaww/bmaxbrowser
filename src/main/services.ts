import type { CertCache } from './net/cert-cache'
import type { RequestPipeline } from './net/RequestPipeline'
import type { PermissionManager } from './permissions/PermissionManager'
import type { SessionManager } from './sessions/SessionManager'
import type { SettingsStore } from './settings/SettingsStore'
import type { StatsStore } from './settings/StatsStore'
import type { DownloadManager } from './downloads/DownloadManager'
import type { MediaTracker } from './downloads/MediaTracker'
import type { ShieldsManager } from './shields/ShieldsManager'
import type { TorrentManager } from './torrents/TorrentManager'
import type { TorManager } from './tor/TorManager'
import type { Vault } from './vault/Vault'
import type { WindowManager } from './windows/WindowManager'
import type { ExtensionManager } from './extensions/ExtensionManager'
import type { ReaderManager } from './reader/ReaderManager'
import type { SessionRestore } from './session/SessionRestore'
import type { TabSleeper } from './tabs/TabSleeper'
import type { UpdateManager } from './updates/UpdateManager'

/** Process-wide singletons, populated once in index.ts after app 'ready'. */
export interface Services {
  settings: SettingsStore
  stats: StatsStore
  certs: CertCache
  pipeline: RequestPipeline
  permissions: PermissionManager
  sessions: SessionManager
  windows: WindowManager
  tor: TorManager
  shields: ShieldsManager
  downloads: DownloadManager
  media: MediaTracker
  torrents: TorrentManager
  vault: Vault
  reader: ReaderManager
  sleeper: TabSleeper
  restore: SessionRestore
  extensions: ExtensionManager
  updates: UpdateManager
  /** Start-up timing (performance budget: first window < 2 s). */
  metrics: { firstWindowMs: number | null; readyMs: number | null }
}

export const services = {} as Services
