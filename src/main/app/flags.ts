import { app } from 'electron'

/**
 * Chromium switches that keep the browser quiet: no background networking, no component updater,
 * no hyperlink auditing pings, no disk shader cache. Must run before app 'ready'.
 */
export function applyFlags(): void {
  const cl = app.commandLine
  cl.appendSwitch('disable-background-networking')
  cl.appendSwitch('disable-component-update')
  cl.appendSwitch('disable-domain-reliability')
  cl.appendSwitch('disable-sync')
  cl.appendSwitch('disable-breakpad')
  cl.appendSwitch('disable-gpu-shader-disk-cache')
  cl.appendSwitch('no-pings')
  cl.appendSwitch('no-default-browser-check')
  cl.appendSwitch('metrics-recording-only')
  cl.appendSwitch(
    'disable-features',
    [
      'Translate',
      'MediaRouter',
      'OptimizationHints',
      'AutofillServerCommunication',
      'CertificateTransparencyComponentUpdater',
      'InterestFeedContentSuggestions'
    ].join(',')
  )
  // Belt and braces; the real policy is applied per webContents in Phase 2.
  cl.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp')
}
