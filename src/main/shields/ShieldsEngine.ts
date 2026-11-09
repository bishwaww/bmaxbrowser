import { FiltersEngine, Request } from '@ghostery/adblocker'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BlockCategory, EngineStatus } from '@shared/shields'
import { readJson, writeJsonAtomic } from '../settings/JsonStore'
import type { BuildRequest, BuildResult } from './engine-worker'
import EngineWorker from './engine-worker?nodeWorker'
import type { ListStore } from './ListStore'

interface CacheMeta {
  signature: string
  builtAt: number
  network: number
  cosmetic: number
}

export interface MatchInput {
  url: string
  /** Top-level page URL (used for third-party and $domain matching). */
  sourceUrl: string
  /** Electron resource type, e.g. 'script', 'xhr', 'image'. */
  resourceType: string
  tabId: number
  requestId: string
}

export type MatchOutcome = { action: 'allow' } | { action: 'block'; category: BlockCategory } | { action: 'redirect'; category: BlockCategory; url: string }

const TYPE_MAP: Record<string, string> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other'
}

export interface CosmeticResult {
  styles: string
  scripts: string[]
}

/**
 * Holds the compiled filter engines:
 *  - `trackers` (EasyPrivacy, uBO privacy/badware, URLhaus …) is matched first so blocked items can be counted as trackers;
 *  - `ads` (EasyList, uBO filters, AdGuard, annoyances …) second;
 *  - `custom` (the user's own rules and element-picker rules) overrides both, including `@@` exceptions.
 */
export class ShieldsEngine {
  ads: FiltersEngine | null = null
  trackers: FiltersEngine | null = null
  custom: FiltersEngine | null = null
  status: EngineStatus = { state: 'idle', message: 'Not loaded', builtAt: 0, networkRules: 0, cosmeticRules: 0 }

  constructor(private store: ListStore) {}

  private file(name: string): string {
    return join(this.store.dir, name)
  }

  setStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch }
  }

  /** Load previously compiled engines if they match the wanted signature. */
  loadCache(signature: string): boolean {
    try {
      const meta = readJson(this.file('engine.json')) as CacheMeta | undefined
      if (!meta || meta.signature !== signature) return false
      const adsFile = this.file('engine-ads.bin')
      const trkFile = this.file('engine-trackers.bin')
      if (!existsSync(adsFile) || !existsSync(trkFile)) return false
      const ads = FiltersEngine.deserialize(new Uint8Array(readFileSync(adsFile)))
      const trackers = FiltersEngine.deserialize(new Uint8Array(readFileSync(trkFile)))
      this.ads = ads
      this.trackers = trackers
      this.setStatus({ state: 'ready', message: 'Ready', builtAt: meta.builtAt, networkRules: meta.network, cosmeticRules: meta.cosmetic })
      return true
    } catch (err) {
      console.warn('[shields] cache load failed', err instanceof Error ? err.message : err)
      return false
    }
  }

  /** Compile lists in a worker thread, swap the new engines in, and persist them. */
  async build(signature: string, req: BuildRequest): Promise<boolean> {
    this.setStatus({ state: 'building', message: 'Compiling filter lists…' })
    const worker = EngineWorker()
    try {
      const result = await new Promise<BuildResult>((resolve, reject) => {
        worker.once('message', (m: { ok: boolean; result?: BuildResult; error?: string }) =>
          m.ok && m.result ? resolve(m.result) : reject(new Error(m.error ?? 'worker failed'))
        )
        worker.once('error', reject)
        worker.postMessage(req)
      })
      const ads = FiltersEngine.deserialize(result.ads)
      const trackers = FiltersEngine.deserialize(result.trackers)
      const builtAt = Date.now()
      this.ads = ads
      this.trackers = trackers
      this.setStatus({ state: 'ready', message: 'Ready', builtAt, networkRules: result.network, cosmeticRules: result.cosmetic })
      this.persist(result, signature, builtAt)
      return true
    } catch (err) {
      this.setStatus({ state: 'error', message: `Could not compile filter lists: ${err instanceof Error ? err.message : String(err)}` })
      return false
    } finally {
      void worker.terminate()
    }
  }

  private persist(result: BuildResult, signature: string, builtAt: number): void {
    try {
      for (const [name, data] of [['engine-ads.bin', result.ads], ['engine-trackers.bin', result.trackers]] as const) {
        const p = this.file(name)
        writeFileSync(`${p}.tmp`, data)
        renameSync(`${p}.tmp`, p)
      }
      const meta: CacheMeta = { signature, builtAt, network: result.network, cosmetic: result.cosmetic }
      writeJsonAtomic(this.file('engine.json'), meta)
    } catch (err) {
      console.warn('[shields] could not cache engine', err instanceof Error ? err.message : err)
    }
  }

  /** (Re)compile the user's own rules (small: done synchronously). Returns the number of rule lines. */
  setCustom(text: string): number {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('!')).length
    this.custom = lines > 0 ? FiltersEngine.parse(text, { enableMutationObserver: true, guessRequestTypeFromUrl: true }) : null
    if (this.custom && this.ads) this.custom.resources = this.ads.resources
    return lines
  }

  /** Share the scriptlet resources with the custom engine after the main engines (re)load. */
  syncCustomResources(): void {
    if (this.custom && this.ads) this.custom.resources = this.ads.resources
  }

  hasAny(): boolean {
    return this.ads !== null || this.trackers !== null || this.custom !== null
  }

  match(input: MatchInput): MatchOutcome {
    const req = Request.fromRawDetails({
      url: input.url,
      sourceUrl: input.sourceUrl,
      type: (TYPE_MAP[input.resourceType] ?? 'other') as never,
      tabId: input.tabId,
      requestId: input.requestId
    })
    if (this.custom) {
      const r = this.custom.match(req)
      if (r.exception) return { action: 'allow' }
      if (r.redirect) return { action: 'redirect', category: 'custom', url: r.redirect.dataUrl }
      if (r.match) return { action: 'block', category: 'custom' }
    }
    if (this.trackers) {
      const r = this.trackers.match(req)
      if (r.redirect) return { action: 'redirect', category: 'tracker', url: r.redirect.dataUrl }
      if (r.match) return { action: 'block', category: 'tracker' }
      if (r.exception) return { action: 'allow' }
    }
    if (this.ads) {
      const r = this.ads.match(req)
      if (r.redirect) return { action: 'redirect', category: 'ad', url: r.redirect.dataUrl }
      if (r.match) return { action: 'block', category: 'ad' }
    }
    return { action: 'allow' }
  }

  /** Extra CSP directives some filters ($csp) want injected into document responses. */
  csp(input: MatchInput): string | undefined {
    const req = Request.fromRawDetails({ url: input.url, sourceUrl: input.sourceUrl, type: (TYPE_MAP[input.resourceType] ?? 'other') as never, tabId: input.tabId })
    const parts: string[] = []
    for (const e of [this.custom, this.trackers, this.ads]) {
      const d = e?.getCSPDirectives(req)
      if (d) parts.push(d)
    }
    return parts.length ? parts.join('; ') : undefined
  }

  /** Cosmetic filtering (CSS hiding rules) and scriptlet injections for a document. */
  cosmetics(
    url: string,
    hostname: string,
    domain: string,
    dom: { classes?: string[]; hrefs?: string[]; ids?: string[] } | undefined,
    caller: { frameId?: number; processId?: number }
  ): CosmeticResult {
    const first = dom === undefined
    const styles: string[] = []
    const scripts: string[] = []
    for (const engine of [this.custom, this.trackers, this.ads]) {
      if (!engine) continue
      const r = engine.getCosmeticsFilters({
        url,
        hostname,
        domain,
        classes: dom?.classes,
        hrefs: dom?.hrefs,
        ids: dom?.ids,
        getBaseRules: first,
        getInjectionRules: first,
        getExtendedRules: false,
        getRulesFromHostname: first,
        getRulesFromDOM: !first,
        callerContext: { frameId: caller.frameId ?? 0, processId: caller.processId ?? 0 }
      })
      if (r.active === false) continue
      if (r.styles) styles.push(r.styles)
      scripts.push(...r.scripts)
    }
    // quick-fixes / unbreak live in both engines; running the same scriptlet twice stacks its proxies, so de-duplicate.
    return { styles: styles.join('\n'), scripts: [...new Set(scripts)] }
  }
}
