import type { Session } from 'electron'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resourcePath } from '../app/paths'

/**
 * Electron downloads Hunspell dictionaries from Google's CDN on Windows/Linux. BMAX makes no such network
 * calls: dictionaries are bundled in resources/dictionaries/<lang>.bdic and served to Chromium from a loopback-only
 * server. With no bundled dictionary, spellcheck stays off (and the download URL is a dead local address).
 */
const DEAD_URL = 'http://127.0.0.1:9/'
let dictionaryUrl: string | null = null
let languages: string[] = []

export async function initSpellcheck(): Promise<void> {
  const dir = resourcePath('dictionaries')
  if (!existsSync(dir)) return
  languages = readdirSync(dir)
    .filter((f) => f.endsWith('.bdic'))
    .map((f) => f.slice(0, -'.bdic'.length))
  if (languages.length === 0) return
  const server = createServer((req, res) => {
    const m = /^\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)-\d+-\d+\.bdic$/.exec(req.url ?? '')
    const lang = m?.[1]
    if (req.method !== 'GET' || !lang || !languages.includes(lang)) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(readFileSync(`${dir}/${lang}.bdic`))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  server.unref()
  dictionaryUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
}

export function configureSpellcheck(ses: Session): void {
  if (!dictionaryUrl) {
    ses.setSpellCheckerDictionaryDownloadURL(DEAD_URL)
    ses.setSpellCheckerEnabled(false)
    return
  }
  ses.setSpellCheckerDictionaryDownloadURL(dictionaryUrl)
  ses.setSpellCheckerLanguages(languages.includes('en-US') ? ['en-US'] : languages.slice(0, 1))
  ses.setSpellCheckerEnabled(true)
}

export function spellcheckAvailable(): boolean {
  return dictionaryUrl !== null
}
