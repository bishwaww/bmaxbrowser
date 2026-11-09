import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ImportedBookmark } from '@shared/bookmarks-import'
import type { Bookmark, PasswordEntry, VaultStatus } from '@shared/vault'

interface VaultData {
  bookmarks: Bookmark[]
  passwords: (PasswordEntry & { password: string })[]
}

interface Envelope {
  v: 1
  salt: string
  iv: string
  tag: string
  ct: string
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }
const AUTO_LOCK_MS = 15 * 60 * 1000

/**
 * Optional local vault for bookmarks and passwords (OFF until the user creates it).
 * Two layers: AES-256-GCM with a key derived (scrypt) from the master password, and the whole envelope wrapped by the
 * OS keystore through Electron safeStorage. Either layer alone is not enough to read the file.
 */
export class Vault {
  private file = ''
  private data: VaultData | null = null
  private key: Buffer | null = null
  private salt: Buffer | null = null
  private failures = 0
  private lockedUntil = 0
  private timer: NodeJS.Timeout | null = null
  onChange: (() => void) | null = null

  init(): void {
    this.file = join(app.getPath('userData'), 'vault.bin')
  }

  /** safeStorage may silently fall back to plaintext on Linux without a keyring; refuse that. */
  available(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
      return true
    } catch {
      return false
    }
  }

  status(): VaultStatus {
    return {
      available: this.available(),
      exists: this.file !== '' && existsSync(this.file),
      unlocked: this.data !== null
    }
  }

  isUnlocked(): boolean {
    return this.data !== null
  }

  private touch(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.lock(), AUTO_LOCK_MS)
    this.timer.unref()
  }

  private derive(master: string, salt: Buffer): Buffer {
    return scryptSync(master.normalize('NFKC'), salt, 32, SCRYPT)
  }

  create(master: string): { ok: boolean; error?: string } {
    if (!this.available()) return { ok: false, error: 'Secure storage is not available on this system.' }
    if (this.status().exists) return { ok: false, error: 'A vault already exists.' }
    if (master.length < 8) return { ok: false, error: 'Use at least 8 characters.' }
    this.salt = randomBytes(16)
    this.key = this.derive(master, this.salt)
    this.data = { bookmarks: [], passwords: [] }
    this.save()
    this.touch()
    this.onChange?.()
    return { ok: true }
  }

  unlock(master: string): { ok: boolean; error?: string } {
    if (this.data) return { ok: true }
    if (Date.now() < this.lockedUntil) return { ok: false, error: 'Too many attempts. Wait a moment and try again.' }
    if (!this.status().exists) return { ok: false, error: 'No vault found.' }
    try {
      const wrapped = readFileSync(this.file)
      const env = JSON.parse(safeStorage.decryptString(wrapped)) as Envelope
      const salt = Buffer.from(env.salt, 'base64')
      const key = this.derive(master, salt)
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(env.tag, 'base64'))
      const plain = Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()])
      this.data = JSON.parse(plain.toString('utf8')) as VaultData
      this.key = key
      this.salt = salt
      this.failures = 0
      this.touch()
      this.onChange?.()
      return { ok: true }
    } catch {
      this.failures++
      this.lockedUntil = Date.now() + Math.min(30_000, 500 * 2 ** Math.min(this.failures, 6))
      return { ok: false, error: 'Wrong master password.' }
    }
  }

  lock(): void {
    this.data = null
    this.key?.fill(0)
    this.key = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.onChange?.()
  }

  /** Delete the vault file (requires the master password). */
  destroy(master: string): { ok: boolean; error?: string } {
    if (!this.status().exists) return { ok: true }
    if (!this.data) {
      const r = this.unlock(master)
      if (!r.ok) return r
    } else if (this.key && this.salt) {
      const check = this.derive(master, this.salt)
      if (!timingSafeEqual(check, this.key)) return { ok: false, error: 'Wrong master password.' }
    }
    this.lock()
    rmSync(this.file, { force: true })
    this.onChange?.()
    return { ok: true }
  }

  private save(): void {
    if (!this.data || !this.key || !this.salt) return
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ct = Buffer.concat([cipher.update(JSON.stringify(this.data), 'utf8'), cipher.final()])
    const env: Envelope = {
      v: 1,
      salt: this.salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64')
    }
    const wrapped = safeStorage.encryptString(JSON.stringify(env))
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, wrapped)
    renameSync(tmp, this.file)
  }

  private need(): VaultData {
    if (!this.data) throw new Error('Vault is locked')
    this.touch()
    return this.data
  }

  // ------------------------------------------------------------------ bookmarks
  bookmarks(): Bookmark[] {
    return [...this.need().bookmarks]
  }
  hasBookmark(url: string): boolean {
    return this.data?.bookmarks.some((b) => b.url === url) ?? false
  }
  addBookmark(b: { title: string; url: string; folder?: string }): Bookmark {
    const d = this.need()
    const existing = d.bookmarks.find((x) => x.url === b.url)
    if (existing) return existing
    const bm: Bookmark = { id: randomUUID(), title: b.title.slice(0, 200) || b.url, url: b.url, folder: b.folder ?? '', added: Date.now() }
    d.bookmarks.push(bm)
    this.save()
    this.onChange?.()
    return bm
  }
  removeBookmark(id: string): void {
    const d = this.need()
    d.bookmarks = d.bookmarks.filter((b) => b.id !== id)
    this.save()
    this.onChange?.()
  }
  removeBookmarkByUrl(url: string): void {
    const d = this.need()
    d.bookmarks = d.bookmarks.filter((b) => b.url !== url)
    this.save()
    this.onChange?.()
  }
  importBookmarks(items: ImportedBookmark[]): number {
    const d = this.need()
    const known = new Set(d.bookmarks.map((b) => b.url))
    let added = 0
    for (const it of items) {
      if (known.has(it.url)) continue
      known.add(it.url)
      d.bookmarks.push({ id: randomUUID(), title: it.title, url: it.url, folder: it.folder, added: Date.now() })
      added++
    }
    if (added) {
      this.save()
      this.onChange?.()
    }
    return added
  }

  // ------------------------------------------------------------------ passwords
  passwords(): PasswordEntry[] {
    return this.need().passwords.map(({ password: _p, ...rest }) => rest)
  }
  reveal(id: string): string | null {
    return this.need().passwords.find((p) => p.id === id)?.password ?? null
  }
  savePassword(p: { id?: string; site: string; username: string; password: string }): PasswordEntry {
    const d = this.need()
    const now = Date.now()
    const existing = p.id ? d.passwords.find((x) => x.id === p.id) : undefined
    if (existing) {
      existing.site = p.site
      existing.username = p.username
      existing.password = p.password
      existing.updated = now
    } else {
      d.passwords.push({ id: randomUUID(), site: p.site, username: p.username, password: p.password, updated: now })
    }
    this.save()
    const saved = existing ?? d.passwords[d.passwords.length - 1]!
    const { password: _p, ...rest } = saved
    return rest
  }
  removePassword(id: string): void {
    const d = this.need()
    d.passwords = d.passwords.filter((p) => p.id !== id)
    this.save()
  }
}
