import { app } from 'electron'
import { EventEmitter } from 'node:events'
import type { AppInfo, UpdateState } from '@shared/updates'
import { services } from '../services'

/** The slice of electron-updater's AppUpdater we use (also lets tests inject a fake). */
export interface UpdaterLike extends EventEmitter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  logger: unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

const DAY_MS = 24 * 3600 * 1000

/** Turn electron-updater's raw errors into something a person can act on. */
export function updateErrorText(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (/\b404\b|not found|cannot find (channel|latest)|no published versions|unable to find latest version/i.test(raw)) {
    return 'No published version was found. The releases page has no release yet, or it is not public.'
  }
  if (/net::ERR|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(raw)) return 'Could not reach the update server. Check the internet connection and try again.'
  return (raw.split('\n')[0] ?? '').slice(0, 300) || fallback
}

/**
 * App updates from GitHub Releases through electron-updater. Nothing is downloaded or installed without the user's click;
 * the only automatic traffic is the version check (about once a day; switch off in Settings → General). Update packages are
 * signature-checked by electron-updater (Windows: publisher name when the build is signed).
 */
export class UpdateManager extends EventEmitter {
  private st: UpdateState = { status: 'idle' }
  private updater: UpdaterLike | null = null
  private timer: NodeJS.Timeout | null = null
  /** Test hooks. */
  loader: () => Promise<UpdaterLike> = async () => {
    // The updater uses its own network partition: make sure it carries the user's proxy setting before its first request.
    services.sessions.updater()
    const mod = (await import('electron-updater')) as { autoUpdater: UpdaterLike }
    return mod.autoUpdater
  }
  forceSupported = false

  state(): UpdateState {
    return this.st
  }

  /** Why this build cannot update itself, or null. */
  unsupportedReason(): string | null {
    if (this.forceSupported) return null
    if (!app.isPackaged) return 'Updates are only available in installed builds. This is a development build.'
    if (process.env['PORTABLE_EXECUTABLE_DIR']) return 'The portable build cannot update itself. Download the new version from the releases page.'
    if (process.platform === 'linux' && !process.env['APPIMAGE']) return 'Update BMAX with your package manager.'
    return null
  }

  info(): AppInfo {
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      updates: this.st
    }
  }

  private set(next: UpdateState): UpdateState {
    this.st = { ...next, checkedAt: next.checkedAt ?? this.st.checkedAt }
    this.emit('state', this.st)
    return this.st
  }

  private async getUpdater(): Promise<UpdaterLike> {
    if (this.updater) return this.updater
    const u = await this.loader()
    u.autoDownload = false
    u.autoInstallOnAppQuit = false
    u.allowPrerelease = false
    u.allowDowngrade = false
    u.logger = null
    u.on('update-available', (info: { version: string }) => this.set({ status: 'available', version: info.version, checkedAt: Date.now() }))
    u.on('update-not-available', () => this.set({ status: 'none', checkedAt: Date.now() }))
    u.on('download-progress', (p: { percent: number }) => this.set({ status: 'downloading', version: this.st.version, progress: Math.round(p.percent) }))
    u.on('update-downloaded', (info: { version: string }) => this.set({ status: 'downloaded', version: info.version }))
    u.on('error', (err: Error) => this.set({ status: 'error', message: updateErrorText(err, 'Update failed'), checkedAt: Date.now() }))
    this.updater = u
    return u
  }

  async check(): Promise<UpdateState> {
    const why = this.unsupportedReason()
    if (why) return this.set({ status: 'unsupported', message: why })
    if (this.st.status === 'checking' || this.st.status === 'downloading') return this.st
    this.set({ status: 'checking' })
    try {
      const u = await this.getUpdater()
      await u.checkForUpdates()
    } catch (err) {
      this.set({ status: 'error', message: updateErrorText(err, 'Update check failed'), checkedAt: Date.now() })
    }
    return this.st
  }

  async download(): Promise<UpdateState> {
    if (this.st.status !== 'available') return this.st
    try {
      const u = await this.getUpdater()
      this.set({ status: 'downloading', version: this.st.version, progress: 0 })
      await u.downloadUpdate()
    } catch (err) {
      this.set({ status: 'error', message: updateErrorText(err, 'Download failed') })
    }
    return this.st
  }

  install(): void {
    if (this.st.status !== 'downloaded' || !this.updater) return
    this.updater.quitAndInstall(false, true)
  }

  /** Check shortly after start-up and then about once a day (only when enabled in settings). */
  schedule(): void {
    if (this.timer || this.unsupportedReason()) return
    const run = (): void => {
      if (services.settings.get().general.checkUpdates) void this.check()
    }
    setTimeout(run, 20_000).unref()
    this.timer = setInterval(run, DAY_MS)
    this.timer.unref()
  }
}
