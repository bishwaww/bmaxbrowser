import { app } from 'electron'
import { dohServers, DOH_PROVIDERS } from '@shared/privacy'
import type { Settings } from '@shared/settings'

/**
 * DNS-over-HTTPS in 'secure' mode: names are resolved ONLY through the chosen DoH server; if it is unreachable the
 * lookup fails instead of falling back to the (observable) system resolver. An invalid custom config falls back to Quad9,
 * never to plain DNS. Not used by Tor windows (the SOCKS proxy resolves names remotely).
 */
export function applyDoh(settings: Settings): void {
  const d = settings.privacy.doh
  if (d.mode === 'off') {
    app.configureHostResolver({ secureDnsMode: 'off' })
    return
  }
  const servers = dohServers(d)
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: 'secure',
    secureDnsServers: servers.length > 0 ? servers : [DOH_PROVIDERS.quad9.url]
  })
}
