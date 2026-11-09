/**
 * Registered on every frame of every tab (session.registerPreloadScript, type 'frame').
 * - bmax:// pages (internal UI) get the typed API.
 * - http(s) pages get privacy hardening injected into the page's main world before any page script runs.
 */
import { ipcRenderer, webFrame } from 'electron'
import { exposeBmaxApi } from './bridge'
import { inject } from './fingerprint'
import { injectYoutube } from './youtube'
import type { WebConfig } from './fingerprint'

if (location.protocol === 'bmax:' || (import.meta.env.DEV && location.origin === 'http://localhost:5173')) {
  // The second condition exists only in dev builds (Vite dev server); main re-checks the URL on every call.
  exposeBmaxApi()
} else if (location.protocol === 'http:' || location.protocol === 'https:' || location.protocol === 'about:') {
  // The seed/settings are decided by main (it knows the session secret and top-level site).
  const cfg = ipcRenderer.sendSync('bmax:web-config') as WebConfig | null
  if (cfg) {
    void webFrame.executeJavaScript(`(${inject.toString()})(${JSON.stringify(cfg)})`)
    if (cfg.youtube) void webFrame.executeJavaScript(`(${injectYoutube.toString()})(${JSON.stringify({ enabled: true })})`)
  }
}
