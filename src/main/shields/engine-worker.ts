import { parentPort } from 'node:worker_threads'
import { FiltersEngine } from '@ghostery/adblocker'

/**
 * Compiles filter lists into serialized engines OFF the main thread (parsing EasyList + AdGuard + friends takes seconds).
 * Input:  { ads: string, trackers: string, resources: string | null }
 * Output: { ads: Uint8Array, trackers: Uint8Array, counts: { network, cosmetic } }
 */
export interface BuildRequest {
  ads: string
  trackers: string
  resources: string | null
}
export interface BuildResult {
  ads: Uint8Array
  trackers: Uint8Array
  network: number
  cosmetic: number
}

function compile(text: string, resources: string | null): FiltersEngine {
  const engine = FiltersEngine.parse(text, { enableMutationObserver: true, guessRequestTypeFromUrl: true })
  if (resources) engine.updateResources(resources, String(resources.length))
  return engine
}

parentPort?.on('message', (req: BuildRequest) => {
  try {
    const ads = compile(req.ads, req.resources)
    const trackers = compile(req.trackers, req.resources)
    const countOf = (e: FiltersEngine): { n: number; c: number } => {
      const f = e.getFilters()
      return { n: f.networkFilters.length, c: f.cosmeticFilters.length }
    }
    const a = countOf(ads)
    const t = countOf(trackers)
    const result: BuildResult = { ads: ads.serialize(), trackers: trackers.serialize(), network: a.n + t.n, cosmetic: a.c + t.c }
    parentPort?.postMessage({ ok: true, result })
  } catch (err) {
    parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
