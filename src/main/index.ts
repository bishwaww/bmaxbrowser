import { app, Menu, nativeTheme, session } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_PUSH } from '@shared/ipc'
import type { PushMessage } from '@shared/ipc'
import { applyFlags } from './app/flags'
import { internalUrl } from '@shared/internal'
import type { DownloadJob } from '@shared/downloads'
import type { Settings } from '@shared/settings'
import type { TorState } from '@shared/types'
import { internalPageOf, isTrustedInternalUrl, registerInternalScheme } from './app/internal-pages'
import { CertCache } from './net/cert-cache'
import { RequestPipeline } from './net/RequestPipeline'
import { registerIpc } from './ipc/router'
import { createHandlers } from './ipc/handlers'
import { applyDoh } from './net/doh'
import { registerPrivacyHandlers } from './net/privacy-handlers'
import { PermissionManager } from './permissions/PermissionManager'
import { registerWebConfig } from './privacy/web-config'
import { TorManager } from './tor/TorManager'
import { DownloadManager } from './downloads/DownloadManager'
import { ensureYtdlp, readToolMeta } from './downloads/tools'
import { MediaTracker } from './downloads/MediaTracker'
import { ShieldsManager } from './shields/ShieldsManager'
import { TorrentManager } from './torrents/TorrentManager'
import { Vault } from './vault/Vault'
import { initSpellcheck } from './privacy/spellcheck'
import { services } from './services'
import { SessionManager } from './sessions/SessionManager'
import { SettingsStore } from './settings/SettingsStore'
import { StatsStore } from './settings/StatsStore'
import { WindowManager } from './windows/WindowManager'
import type { BmaxWindow } from './windows/BmaxWindow'
import { ExtensionManager } from './extensions/ExtensionManager'
import { ReaderManager } from './reader/ReaderManager'
import { SessionRestore } from './session/SessionRestore'
import { TabSleeper } from './tabs/TabSleeper'
import { UpdateManager } from './updates/UpdateManager'

registerInternalScheme()
services.metrics = { firstWindowMs: null, readyMs: null }
applyFlags()

// Optional isolated profile directory for tests (never used in normal runs).
if (process.env['BMAX_USER_DATA']) app.setPath('userData', process.env['BMAX_USER_DATA'])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

/** First http(s) URL on the command line, if any (used when BMAX is launched with a link). */
function urlFromArgv(argv: string[]): string | undefined {
  return argv.slice(1).find((a) => /^https?:\/\//i.test(a))
}

/** A magnet link passed by the OS (BMAX registered as the magnet handler) or on the command line. */
function magnetFromArgv(argv: string[]): string | undefined {
  return argv.slice(1).find((a) => /^magnet:\?/i.test(a))
}

app.on('web-contents-created', (_e, wc) => {
  // Defence in depth for every webContents, including DevTools and anything created later.
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
})

app.on('second-instance', (_e, argv) => {
  const url = urlFromArgv(argv)
  const magnet = magnetFromArgv(argv)
  if (magnet && services.torrents) {
    void services.torrents.handleMagnet(magnet, null, services.windows?.focused())
    return
  }
  const win = services.windows?.focused()
  if (win && !win.isDisposed) {
    if (win.base.isMinimized()) win.base.restore()
    win.base.focus()
    if (url) win.openTab(url)
  } else services.windows?.create({ url })
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  // Save the open tabs once (if the user opted in), then ignore the windows closing one by one.
  services.restore?.flush()
  services.restore?.suppress(true)
  services.settings?.flush()
  services.stats?.flush()
  services.downloads?.reset()
  services.torrents?.reset()
  services.tor?.shutdown()
})

void app.whenReady().then(async () => {
  if (!gotLock) return
  services.metrics.readyMs = Math.round(process.uptime() * 1000)
  if (process.platform === 'win32') app.setAppUserModelId('com.bmax.browser')
  await initSpellcheck()

  services.settings = new SettingsStore()
  services.settings.load()
  // The extension profile is a temporary on-disk profile: delete whatever a previous run (or a crash) left behind.
  try {
    rmSync(join(app.getPath('userData'), 'Partitions', 'bmax-ext'), { recursive: true, force: true })
  } catch {
    /* nothing to remove */
  }
  services.restore = new SessionRestore()
  services.restore.init()
  services.reader = new ReaderManager()
  services.sleeper = new TabSleeper()
  services.extensions = new ExtensionManager()
  services.updates = new UpdateManager()
  services.stats = new StatsStore()
  services.stats.load()
  nativeTheme.themeSource = services.settings.get().theme

  services.certs = new CertCache()
  services.pipeline = new RequestPipeline()
  services.permissions = new PermissionManager(services.settings)
  services.permissions.init()
  services.shields = new ShieldsManager()
  services.downloads = new DownloadManager()
  services.media = new MediaTracker()
  services.torrents = new TorrentManager()
  registerPrivacyHandlers(services.pipeline)
  registerWebConfig()
  services.tor = new TorManager()
  services.vault = new Vault()
  services.vault.init()
  applyDoh(services.settings.get())
  services.sessions = new SessionManager({
    pipeline: services.pipeline,
    permissions: services.permissions,
    certs: services.certs,
    settings: services.settings
  })
  services.windows = new WindowManager()
  // Installed extensions load before the first page so their content scripts apply to it.
  await services.extensions.init()

  // The default session is never used for web content; lock it down anyway.
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  // Native menu bar removed (shortcuts are handled per webContents); macOS keeps a minimal Edit menu so
  // Cmd+C / Cmd+V work in text fields.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'windowMenu' }
      ])
    )
  } else {
    Menu.setApplicationMenu(null)
  }

  registerIpc(createHandlers())

  const broadcast = (msg: PushMessage): void => {
    for (const w of services.windows.all()) {
      w.sendToChrome(msg)
      w.overlays.broadcast(msg)
      for (const t of w.tabs) {
        if (!t.isDestroyed && isTrustedInternalUrl(t.wc.getURL())) t.wc.send(IPC_PUSH, msg)
      }
    }
  }
  const broadcastTheme = (): void => {
    for (const w of services.windows.all()) {
      w.applyTheme()
      const msg: PushMessage = { type: 'theme', theme: w.tor ? 'tor' : nativeTheme.shouldUseDarkColors ? 'dark' : 'light' }
      w.sendToChrome(msg)
      w.overlays.broadcast(msg)
      for (const t of w.tabs) if (!t.isDestroyed && isTrustedInternalUrl(t.wc.getURL())) t.wc.send(IPC_PUSH, msg)
    }
  }
  services.downloads.on('change', (jobs: DownloadJob[]) => {
    for (const w of services.windows.all()) {
      for (const t of w.tabs) {
        if (!t.isDestroyed && internalPageOf(t.wc.getURL()) === 'downloads') t.wc.send(IPC_PUSH, { type: 'downloads', jobs })
      }
    }
  })
  services.torrents.on('change', () => {
    for (const w of services.windows.all()) {
      for (const t of w.tabs) {
        if (!t.isDestroyed && internalPageOf(t.wc.getURL()) === 'torrents') {
          t.wc.send(IPC_PUSH, { type: 'torrents', torrents: services.torrents.torrents(), status: services.torrents.status(w) })
        }
      }
    }
  })
  services.vault.onChange = () => {
    for (const w of services.windows.all()) w.notify()
  }
  services.tor.on('state', (state: TorState) => {
    for (const w of services.windows.all()) {
      if (!w.tor) continue
      w.sendToChrome({ type: 'tor-status', state })
      for (const t of w.tabs) {
        if (t.isDestroyed || internalPageOf(t.wc.getURL()) !== 'tor') continue
        t.wc.send(IPC_PUSH, { type: 'tor-status', state })
        // Connected: leave the progress page for the new-tab page of this Tor window.
        if (state.status === 'ready') t.loadUrl(internalUrl('newtab'))
      }
    }
  })
  const applySiteColorScheme = (): void => {
    for (const w of services.windows.all()) for (const t of w.tabs) void t.applyColorScheme()
  }
  services.settings.on('change', (settings: Settings, prev: Settings) => {
    services.shields.onSettingsChange(prev, settings)
    services.torrents.onSettingsChange({ ...prev.torrents })
    applyDoh(settings)
    services.sessions.applySettings()
    services.restore.onSettingsChange(prev.general.restoreSession)
    const themeChanged = nativeTheme.themeSource !== settings.theme
    nativeTheme.themeSource = settings.theme
    broadcast({ type: 'settings', settings })
    if (themeChanged) broadcastTheme()
    if (themeChanged || prev.siteColorScheme !== settings.siteColorScheme) applySiteColorScheme()
  })
  nativeTheme.on('updated', () => {
    broadcastTheme()
    applySiteColorScheme()
  })
  services.updates.on('state', (state) => broadcast({ type: 'updates', state }))

  // Test hook: only exists when explicitly requested by the e2e harness.
  if (process.env['BMAX_TEST'] === '1') (globalThis as Record<string, unknown>)['__bmax'] = services

  // Opt-in "continue where you left off": reopen last time's windows (only the selected tab of each loads).
  const startUrl = urlFromArgv(process.argv)
  const restored = services.restore.restore()
  let firstWindow: BmaxWindow
  if (restored > 0) {
    firstWindow = services.windows.focused()!
    if (startUrl) firstWindow.openTab(startUrl)
  } else firstWindow = services.windows.create({ url: startUrl })
  const startMagnet = magnetFromArgv(process.argv)
  if (startMagnet) void services.torrents.handleMagnet(startMagnet, null, firstWindow)
  services.shields.init()
  services.sleeper.start()
  if (process.env['BMAX_TEST'] !== '1') services.updates.schedule()
  // Keep yt-dlp current (sites change often): one check per day, shortly after startup. Switchable in Settings → Downloads.
  if (process.env['BMAX_TEST'] !== '1') {
    // Warm up yt-dlp (copy to userData, first-run unpacking) so the first download starts promptly.
    setTimeout(() => void ensureYtdlp(), 20_000).unref()
    setTimeout(() => {
      const d = services.settings.get().downloads
      const last = readToolMeta().ytdlpCheckedAt ?? 0
      if (d.autoUpdateYtdlp && Date.now() - last > 24 * 3600 * 1000) void services.downloads.updateYtdlp(null)
    }, 45_000).unref()
  }
})
