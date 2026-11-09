import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { ListDef } from '@shared/shields'
import { RESOURCES_URL } from '@shared/shields'
import { readJson, writeJsonAtomic } from '../settings/JsonStore'

export interface ListMeta {
  etag?: string
  lastModified?: string
  fetchedAt: number
  bytes: number
}

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>

const MAX_BYTES = 40 * 1024 * 1024
export const STALE_MS = 12 * 60 * 60 * 1000

/** Raw filter lists + uBO scriptlet resources cached under userData/shields. Filter data only — never browsing data. */
export class ListStore {
  readonly dir: string
  private metaFile: string
  private meta: Record<string, ListMeta> = {}

  constructor() {
    this.dir = join(app.getPath('userData'), 'shields')
    this.metaFile = join(this.dir, 'meta.json')
  }

  load(): void {
    mkdirSync(join(this.dir, 'lists'), { recursive: true })
    const raw = readJson(this.metaFile)
    if (raw && typeof raw === 'object') this.meta = raw as Record<string, ListMeta>
  }

  private path(id: string): string {
    return join(this.dir, 'lists', `${id.replace(/[^a-z0-9-]/gi, '_')}.txt`)
  }

  info(id: string): ListMeta | undefined {
    return this.meta[id]
  }

  read(id: string): string | null {
    const p = this.path(id)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  readResources(): string | null {
    const p = join(this.dir, 'resources.json')
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  /** Test/offline helper: store list text as if it had just been downloaded. */
  seed(id: string, text: string): void {
    writeFileSync(this.path(id), text, 'utf8')
    this.meta[id] = { fetchedAt: Date.now(), bytes: Buffer.byteLength(text) }
    this.saveMeta()
  }

  isStale(id: string, now = Date.now()): boolean {
    const m = this.meta[id]
    return !m || now - m.fetchedAt > STALE_MS || !existsSync(this.path(id))
  }

  private async download(url: string, id: string, fetcher: Fetcher): Promise<{ status: 'updated' | 'unchanged'; text: string }> {
    const prev = this.meta[id]
    const headers: Record<string, string> = { Accept: 'text/plain,*/*' }
    if (prev?.etag) headers['If-None-Match'] = prev.etag
    else if (prev?.lastModified) headers['If-Modified-Since'] = prev.lastModified
    const res = await fetcher(url, { headers, signal: AbortSignal.timeout(90_000) })
    if (res.status === 304 && prev) {
      this.meta[id] = { ...prev, fetchedAt: Date.now() }
      return { status: 'unchanged', text: '' }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error('unexpected size')
    const meta: ListMeta = { fetchedAt: Date.now(), bytes: buf.length }
    const etag = res.headers.get('etag')
    const lm = res.headers.get('last-modified')
    if (etag) meta.etag = etag
    if (lm) meta.lastModified = lm
    this.meta[id] = meta
    return { status: 'updated', text: buf.toString('utf8') }
  }

  /** Download one list. Returns whether its content changed. Failures keep the previously cached copy. */
  async refresh(def: ListDef, fetcher: Fetcher): Promise<'updated' | 'unchanged' | 'failed'> {
    try {
      const r = await this.download(def.url, def.id, fetcher)
      if (r.status === 'updated') {
        const p = this.path(def.id)
        writeFileSync(`${p}.tmp`, r.text, 'utf8')
        renameSync(`${p}.tmp`, p)
      }
      this.saveMeta()
      return r.status
    } catch (err) {
      console.warn(`[shields] list ${def.id} failed:`, err instanceof Error ? err.message : err)
      return 'failed'
    }
  }

  async refreshResources(fetcher: Fetcher): Promise<'updated' | 'unchanged' | 'failed'> {
    try {
      const r = await this.download(RESOURCES_URL, '__resources', fetcher)
      if (r.status === 'updated') {
        const p = join(this.dir, 'resources.json')
        writeFileSync(`${p}.tmp`, r.text, 'utf8')
        renameSync(`${p}.tmp`, p)
      }
      this.saveMeta()
      return r.status
    } catch (err) {
      console.warn('[shields] resources failed:', err instanceof Error ? err.message : err)
      return 'failed'
    }
  }

  private saveMeta(): void {
    try {
      writeJsonAtomic(this.metaFile, this.meta)
    } catch {
      /* best effort */
    }
  }

  // ------------------------------------------------------------------ custom user rules
  private customFile(): string {
    return join(this.dir, 'custom-rules.txt')
  }
  readCustom(): string {
    return existsSync(this.customFile()) ? readFileSync(this.customFile(), 'utf8') : ''
  }
  writeCustom(text: string): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.customFile(), text, 'utf8')
  }
}
