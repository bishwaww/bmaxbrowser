import { app, dialog } from 'electron'
import type { BaseWindow, Extension } from 'electron'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { summarizeManifest } from '@shared/extensions'
import type { ExtensionInfo, ManifestSummary } from '@shared/extensions'
import type { ExtensionResult } from '@shared/ipc'
import { services } from '../services'
import { EXT_PARTITION } from '../sessions/SessionManager'
import { readJson, writeJsonAtomic } from '../settings/JsonStore'
import { extractCrx } from './crx'

const recordsSchema = z.array(z.object({ id: z.string().regex(/^[a-p]{32}$/), enabled: z.boolean() })).max(200)
type Records = z.infer<typeof recordsSchema>

const MAX_FILES = 8000
const MAX_BYTES = 200 * 1024 * 1024
const MAX_PACKAGE = 120 * 1024 * 1024

/** Random 32-letter id (a–p), the same shape as a Chrome extension id; also the folder name under userData/extensions. */
function newId(): string {
  return [...randomBytes(32)].map((b) => String.fromCharCode(97 + (b % 16))).join('')
}

/** Copy an extension folder, refusing symlinks and absurd sizes. */
function copyTree(src: string, dest: string): void {
  let files = 0
  let bytes = 0
  const check = (p: string): boolean => {
    const st = lstatSync(p)
    if (st.isSymbolicLink()) throw new Error('The extension folder contains a symbolic link, which is not allowed.')
    if (st.isFile()) {
      files++
      bytes += st.size
      if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error('The extension is too large.')
    }
    return true
  }
  cpSync(src, dest, { recursive: true, dereference: false, filter: (s) => check(s) })
}

function readManifest(dir: string): { summary: ManifestSummary } {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) throw new Error('No manifest.json found in that folder.')
  if (statSync(file).size > 1_000_000) throw new Error('manifest.json is too large.')
  let raw: unknown
  try {
    // Strip a BOM; Chrome tolerates it.
    raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('manifest.json is not valid JSON.')
  }
  return { summary: summarizeManifest(raw) }
}

/** The folder holding the extension if `dir` is it, or its only sub-folder (zip files often wrap everything in one folder). */
function findExtensionRoot(dir: string): string {
  if (existsSync(join(dir, 'manifest.json'))) return dir
  const subs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
  const only = subs.length === 1 && readdirSync(dir).length === 1 ? subs[0] : undefined
  if (only && existsSync(join(dir, only.name, 'manifest.json'))) return join(dir, only.name)
  return dir
}

/**
 * Basic Chrome-extension support on Electron's own extension implementation (content scripts, background workers, the
 * chrome.* subset Electron provides). Not supported: toolbar buttons/popups (use "Open popup" in Settings), the Web
 * Store, and most chrome.tabs/windows APIs. Extensions run only in extension windows (Electron cannot load them into
 * memory-only sessions, so these windows use a temporary on-disk profile): never in normal, Tor, isolated or container tabs.
 */
export class ExtensionManager {
  private root = ''
  private file = ''
  private records: Records = []
  /** UI id → the loaded Electron extension (its Chromium id differs: it is derived from the install path). */
  private loaded = new Map<string, Extension>()
  private errors = new Map<string, string>()

  async init(): Promise<void> {
    this.root = join(app.getPath('userData'), 'extensions')
    this.file = join(this.root, 'extensions.json')
    const parsed = recordsSchema.safeParse(readJson(this.file))
    this.records = parsed.success ? parsed.data : []
    // Drop records whose folder vanished.
    this.records = this.records.filter((r) => existsSync(join(this.root, r.id, 'manifest.json')))
  }

  /** Load the enabled extensions into the extension profile (created on first use, not at start-up). */
  async ensureLoaded(): Promise<void> {
    for (const r of this.records) if (r.enabled && !this.loaded.has(r.id) && !this.errors.has(r.id)) await this.load(r.id)
  }

  private save(): void {
    if (this.records.length === 0 && !existsSync(this.file)) return
    mkdirSync(this.root, { recursive: true })
    writeJsonAtomic(this.file, this.records)
  }

  private session(): Electron.Session {
    return services.sessions.web(EXT_PARTITION)
  }

  private async load(id: string): Promise<boolean> {
    try {
      const ext = await this.session().extensions.loadExtension(join(this.root, id), { allowFileAccess: false })
      this.loaded.set(id, ext)
      this.errors.delete(id)
      return true
    } catch (err) {
      this.errors.set(id, err instanceof Error ? err.message : 'The extension could not be loaded.')
      return false
    }
  }

  private unload(id: string): void {
    const ext = this.loaded.get(id)
    if (!ext) return
    try {
      this.session().extensions.removeExtension(ext.id)
    } catch {
      /* already gone */
    }
    this.loaded.delete(id)
  }

  list(): ExtensionInfo[] {
    const out: ExtensionInfo[] = []
    for (const r of this.records) {
      try {
        const { summary } = readManifest(join(this.root, r.id))
        out.push({
          id: r.id,
          name: summary.name,
          version: summary.version,
          description: summary.description,
          enabled: r.enabled,
          manifestVersion: summary.manifestVersion,
          permissions: summary.permissions,
          allSites: summary.allSites,
          optionsPage: summary.optionsPage,
          popupPage: summary.popupPage,
          error: r.enabled ? this.errors.get(r.id) : undefined
        })
      } catch (err) {
        out.push({
          id: r.id,
          name: 'Unreadable extension',
          version: '',
          description: '',
          enabled: false,
          manifestVersion: 0,
          permissions: [],
          allSites: false,
          optionsPage: null,
          popupPage: null,
          error: err instanceof Error ? err.message : 'Unreadable manifest'
        })
      }
    }
    return out
  }

  /** Validate, confirm with the user, copy into the app data folder and load. `confirm` is injectable for tests. */
  async installFrom(srcDir: string, confirm: (s: ManifestSummary) => Promise<boolean>): Promise<ExtensionResult> {
    try {
      const dir = findExtensionRoot(resolve(srcDir))
      const { summary } = readManifest(dir)
      if (this.records.length >= 100) return { ok: false, message: 'Too many extensions are installed.' }
      if (!(await confirm(summary))) return { ok: false, message: 'Installation cancelled.' }
      const id = newId()
      mkdirSync(this.root, { recursive: true })
      copyTree(dir, join(this.root, id))
      this.records.push({ id, enabled: true })
      if (!(await this.load(id))) {
        const message = this.errors.get(id) ?? 'The extension could not be loaded.'
        this.records = this.records.filter((r) => r.id !== id)
        rmSync(join(this.root, id), { recursive: true, force: true })
        this.errors.delete(id)
        return { ok: false, message }
      }
      this.save()
      return { ok: true, message: `Installed ${summary.name} ${summary.version}.` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Installation failed.' }
    }
  }

  async installCrxFile(file: string, confirm: (s: ManifestSummary) => Promise<boolean>): Promise<ExtensionResult> {
    if (statSync(file).size > MAX_PACKAGE) return { ok: false, message: 'That package is too large.' }
    const tmp = mkdtempSync(join(tmpdir(), 'bmax-crx-'))
    try {
      extractCrx(readFileSync(file), tmp)
      return await this.installFrom(tmp, confirm)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Could not unpack the package.' }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  private confirmDialog(parent: BaseWindow | null): (s: ManifestSummary) => Promise<boolean> {
    return async (s) => {
      const options = {
        type: 'warning' as const,
        buttons: ['Cancel', 'Install'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Install extension?',
        message: `Install "${s.name}" ${s.version}?`,
        detail: [
          'It will be able to:',
          ...s.permissions.map((p) => `• ${p}`),
          '',
          'Extensions can see what you do on the sites they run on. Install only extensions you trust. They run in normal windows only: never in Tor, isolated or container windows. BMAX does not verify who published this package.'
        ].join('\n')
      }
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
      return response === 1
    }
  }

  async installUnpacked(parent: BaseWindow | null): Promise<ExtensionResult> {
    const opts = { title: 'Choose an unpacked extension folder', properties: ['openDirectory' as const] }
    const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    const dir = res.filePaths[0]
    if (res.canceled || !dir) return { ok: false, message: 'Installation cancelled.' }
    return this.installFrom(dir, this.confirmDialog(parent))
  }

  async installCrx(parent: BaseWindow | null): Promise<ExtensionResult> {
    const opts = {
      title: 'Choose an extension package',
      properties: ['openFile' as const],
      filters: [{ name: 'Chrome extension (.crx, .zip)', extensions: ['crx', 'zip'] }]
    }
    const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    const file = res.filePaths[0]
    if (res.canceled || !file) return { ok: false, message: 'Installation cancelled.' }
    return this.installCrxFile(file, this.confirmDialog(parent))
  }

  async setEnabled(id: string, enabled: boolean): Promise<ExtensionResult> {
    const r = this.records.find((x) => x.id === id)
    if (!r) return { ok: false, message: 'Unknown extension.' }
    r.enabled = enabled
    if (enabled) {
      if (!this.loaded.has(id) && !(await this.load(id))) return { ok: false, message: this.errors.get(id) ?? 'The extension could not be loaded.' }
    } else this.unload(id)
    this.save()
    return { ok: true }
  }

  remove(id: string): ExtensionResult {
    if (!this.records.some((x) => x.id === id)) return { ok: false, message: 'Unknown extension.' }
    this.unload(id)
    this.records = this.records.filter((x) => x.id !== id)
    rmSync(join(this.root, id), { recursive: true, force: true })
    this.errors.delete(id)
    this.save()
    return { ok: true }
  }

  /** chrome-extension:// URL of one of the extension's pages (null when it is not running). */
  pageUrl(id: string, page: 'options' | 'popup'): string | null {
    const ext = this.loaded.get(id)
    const info = this.list().find((e) => e.id === id)
    const rel = page === 'options' ? info?.optionsPage : info?.popupPage
    if (!ext || !rel) return null
    return `chrome-extension://${ext.id}/${rel}`
  }

  /** Test hook: the Chromium extension for a UI id. */
  chromiumId(id: string): string | null {
    return this.loaded.get(id)?.id ?? null
  }
}
