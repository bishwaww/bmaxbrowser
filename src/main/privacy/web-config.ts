import { ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { isThirdParty, siteOf } from '@shared/privacy'
import { registry } from '../app/registry'
import { services } from '../services'

/** Per-frame privacy configuration, requested synchronously by the web preload before page scripts run. */
export function registerWebConfig(): void {
  ipcMain.on('bmax:web-config', (event) => {
    const info = registry.get(event.sender.id)
    if (info?.role !== 'tab') {
      event.returnValue = null
      return
    }
    const s = services.settings.get().privacy
    const frameUrl = event.senderFrame?.url ?? ''
    const topUrl = event.senderFrame?.top?.url ?? event.sender.getURL()
    let site: string
    try {
      site = siteOf(new URL(topUrl).hostname)
    } catch {
      site = ''
    }
    const tor = services.sessions.isTor(info.tab.partition)
    const seed = createHash('sha256').update(`${services.sessions.secret(info.tab.partition)}|${site}`).digest('hex').slice(0, 32)
    event.returnValue = {
      fp: s.fingerprintProtection || tor,
      seed,
      tor,
      gpc: s.sendGpc,
      uniformUa: s.uniformUserAgent || tor,
      major: Number(process.versions.chrome.split('.')[0]),
      thirdParty: (s.blockThirdPartyCookies || tor) && isThirdParty(topUrl, frameUrl)
    }
  })
}
