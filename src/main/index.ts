import { app, Menu, nativeTheme, session } from 'electron'
import { IPC_PUSH } from '@shared/ipc'
import type { PushMessage } from '@shared/ipc'
import { applyFlags } from './app/flags'
import { internalUrl } from '@shared/internal'
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
import { Vault } from './vault/Vault'
import { initSpellcheck } from './privacy/spellcheck'
import { services } from './services'
import { SessionManager } from './sessions/SessionManager'
import { SettingsStore } from './settings/SettingsStore'
import { StatsStore } from './settings/StatsStore'
import { WindowManager } from './windows/WindowManager'

registerInternalScheme()
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

app.on('web-contents-created', (_e, wc) => {
  // Defence in depth for every webContents, including DevTools and anything created later.
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
})

app.on('second-instance', (_e, argv) => {
  const url = urlFromArgv(argv)
  const win = services.windows?.focused()
  if (win && !win.isDisposed) {
    if (win.base.isMinimized()) win.base.restore()
    win.base.focus()
    if (url) win.openTab(url)
  } else services.windows?.create({ url })
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  services.settings?.flush()
  services.stats?.flush()
  services.tor?.shutdown()
})

void app.whenReady().then(async () => {
  if (!gotLock) return
  await initSpellcheck()

  services.settings = new SettingsStore()
  services.settings.load()
  services.stats = new StatsStore()
  services.stats.load()
  nativeTheme.themeSource = services.settings.get().theme

  services.certs = new CertCache()
  services.pipeline = new RequestPipeline()
  services.permissions = new PermissionManager(services.settings)
  services.permissions.init()
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
  services.settings.on('change', (settings) => {
    applyDoh(settings)
    services.sessions.applySettings()
    const themeChanged = nativeTheme.themeSource !== settings.theme
    nativeTheme.themeSource = settings.theme
    broadcast({ type: 'settings', settings })
    if (themeChanged) broadcastTheme()
  })
  nativeTheme.on('updated', broadcastTheme)

  // Test hook: only exists when explicitly requested by the e2e harness.
  if (process.env['BMAX_TEST'] === '1') (globalThis as Record<string, unknown>)['__bmax'] = services

  services.windows.create({ url: urlFromArgv(process.argv) })
})
