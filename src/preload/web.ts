/**
 * Registered on every frame of every tab (session.registerPreloadScript, type 'frame').
 * - bmax:// pages (internal UI) get the typed API.
 * - Everything else gets privacy hardening injected into the page's main world (Phase 2 fleshes this out).
 */
import { webFrame } from 'electron'
import { exposeBmaxApi } from './bridge'

if (location.protocol === 'bmax:' || (import.meta.env.DEV && location.origin === 'http://localhost:5173')) {
  // The second condition exists only in dev builds (Vite dev server); main re-checks the URL on every call.
  exposeBmaxApi()
} else if (location.protocol === 'http:' || location.protocol === 'https:') {
  // Spike (c): prove main-world injection works at document start in every frame (incl. iframes).
  void webFrame.executeJavaScript(
    `(() => { try { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4, configurable: true }); } catch (e) {} })()`
  )
}
