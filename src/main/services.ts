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
}

export const services = {} as Services
