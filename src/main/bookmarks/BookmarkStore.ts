import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ImportedBookmark } from '@shared/bookmarks-import'
import type { Bookmark } from '@shared/vault'
import { readJson, writeJsonAtomic } from '../settings/JsonStore'

const MAX = 5000
const MAX_ICON = 24_000

const schema = z
  .array(
    z.object({
      id: z.string().max(64),
      title: z.string().max(300),
      url: z.string().max(2048),
      folder: z.string().max(300),
      added: z.number(),
      icon: z.string().max(MAX_ICON).optional()
    })
  )
  .max(MAX)

/**
 * Bookmarks: a plain list in bookmarks.json in the app data folder, always available (no master password). They are the
 * one thing about browsing the user deliberately keeps; they are NOT encrypted (saved passwords stay in the encrypted vault).
 */
export class BookmarkStore {
  private file = ''
  private items: Bookmark[] = []
  onChange: (() => void) | null = null

  init(): void {
    this.file = join(app.getPath('userData'), 'bookmarks.json')
    const parsed = schema.safeParse(readJson(this.file))
    this.items = parsed.success ? parsed.data : []
  }

  private save(): void {
    if (!this.file) return
    if (this.items.length === 0 && !existsSync(this.file)) return
    try {
      writeJsonAtomic(this.file, this.items)
    } catch (err) {
      console.error('[bookmarks] save failed', err)
    }
    this.onChange?.()
  }

  list(): Bookmark[] {
    return [...this.items]
  }

  has(url: string): boolean {
    return this.items.some((b) => b.url === url)
  }

  add(b: { title: string; url: string; folder?: string | undefined; icon?: string | null | undefined }): Bookmark {
    const existing = this.items.find((x) => x.url === b.url)
    if (existing) return existing
    if (this.items.length >= MAX) throw new Error('Too many bookmarks.')
    const icon = b.icon && b.icon.startsWith('data:image/') && b.icon.length <= MAX_ICON ? b.icon : undefined
    const bm: Bookmark = { id: randomUUID(), title: b.title.slice(0, 200) || b.url, url: b.url.slice(0, 2048), folder: (b.folder ?? '').slice(0, 200), added: Date.now(), ...(icon ? { icon } : {}) }
    this.items.push(bm)
    this.save()
    return bm
  }

  remove(id: string): void {
    const before = this.items.length
    this.items = this.items.filter((b) => b.id !== id)
    if (this.items.length !== before) this.save()
  }

  removeByUrl(url: string): void {
    const before = this.items.length
    this.items = this.items.filter((b) => b.url !== url)
    if (this.items.length !== before) this.save()
  }

  get(id: string): Bookmark | undefined {
    return this.items.find((b) => b.id === id)
  }

  /** Add many (HTML import, or bookmarks moved out of an old vault). Duplicates by address are skipped. */
  import(items: (ImportedBookmark | Bookmark)[]): number {
    const known = new Set(this.items.map((b) => b.url))
    let added = 0
    for (const it of items) {
      if (!it.url || known.has(it.url) || this.items.length >= MAX) continue
      known.add(it.url)
      this.items.push({ id: randomUUID(), title: (it.title || it.url).slice(0, 200), url: it.url.slice(0, 2048), folder: (it.folder ?? '').slice(0, 200), added: Date.now() })
      added++
    }
    if (added) this.save()
    return added
  }
}
