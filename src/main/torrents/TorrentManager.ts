import { app, dialog, shell, utilityProcess } from 'electron'
import type { DownloadItem, UtilityProcess } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { proxyRules } from '@shared/privacy'
import { parseMagnet } from '@shared/torrents'
import type { TorrentConfig, TorrentInfo, TorrentsStatus, WorkerMessage, WorkerRequest } from '@shared/torrents'
import { services } from '../services'
import type { Tab } from '../tabs/Tab'
import type { BmaxWindow } from '../windows/BmaxWindow'
import workerPath from './worker?modulePath'

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

const MAX_TORRENT_FILE = 5 * 1024 * 1024
export const TOR_TORRENT_MESSAGE =
  'Torrents are disabled in Tor windows. Torrent traffic is not routed through Tor and would expose your real IP address to every peer.'

/** Owns the torrent engine process and everything the UI may ask of it. Torrents live in memory only; files stay on disk. */
export class TorrentManager extends EventEmitter {
  private proc: UtilityProcess | null = null
  private starting: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private list: TorrentInfo[] = []
  private port = 0
  private acknowledged = false
  private restartPending = false

  // ------------------------------------------------------------------ config

  folder(): string {
    const f = services.settings.get().torrents.folder
    const dir = f && existsSync(f) ? f : join(app.getPath('downloads'), 'Torrents')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private config(): TorrentConfig {
    const t = services.settings.get().torrents
    return {
      folder: this.folder(),
      downKBps: t.downKBps,
      upKBps: t.upKBps,
      maxConnections: t.maxConnections,
      stopSeedingWhenDone: t.stopSeedingWhenDone,
      askFiles: t.askFiles,
      dht: t.dht,
      lsd: t.lsd,
      upnp: t.upnp
    }
  }

  onSettingsChange(prevT: TorrentConfig | null): void {
    if (!this.proc) return
    const next = this.config()
    void this.request({ cmd: 'config', config: next }).catch(() => undefined)
    if (prevT && (prevT.dht !== next.dht || prevT.lsd !== next.lsd || prevT.upnp !== next.upnp)) {
      if (this.list.length === 0) this.stop()
      else this.restartPending = true
    }
  }

  // ------------------------------------------------------------------ process

  private ensure(): Promise<void> {
    if (this.proc && !this.starting) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolveReady, rejectReady) => {
      const proc = utilityProcess.fork(workerPath, [], { serviceName: 'bmax-torrents', stdio: 'pipe' })
      this.proc = proc
      proc.stdout?.on('data', (d: Buffer) => process.env['BMAX_DEBUG_TORRENTS'] && console.log('[torrents]', String(d).trim()))
      proc.stderr?.on('data', (d: Buffer) => console.warn('[torrents]', String(d).trim()))
      const timer = setTimeout(() => rejectReady(new Error('The torrent engine did not start.')), 20_000)
      proc.on('message', (m: WorkerMessage) => {
        if (m.event === 'ready') {
          clearTimeout(timer)
          void this.request({ cmd: 'init', config: this.config() })
            .then((r) => {
              this.port = (r as { port: number }).port
              this.restartPending = false
              resolveReady()
            })
            .catch(rejectReady)
        } else if (m.event === 'state') {
          this.list = m.torrents
          this.port = m.port || this.port
          this.emit('change')
        } else if (m.event === 'reply') {
          const p = this.pending.get(m.id)
          if (!p) return
          this.pending.delete(m.id)
          if (m.ok) p.resolve(m.result)
          else p.reject(new Error(m.error))
        }
      })
      proc.on('exit', () => {
        clearTimeout(timer)
        if (this.proc === proc) {
          this.proc = null
          this.port = 0
          this.list = []
          for (const p of this.pending.values()) p.reject(new Error('The torrent engine stopped.'))
          this.pending.clear()
          this.emit('change')
        }
      })
    }).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private request<T = unknown>(req: Req): Promise<T> {
    const proc = this.proc
    if (!proc) return Promise.reject(new Error('The torrent engine is not running.'))
    const id = this.nextId++
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { resolve: res as (v: unknown) => void, reject: rej })
      proc.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  stop(): void {
    const p = this.proc
    this.proc = null
    this.starting = null
    this.list = []
    this.port = 0
    p?.kill()
    this.emit('change')
  }

  /** Burn / quit: drop every torrent (files already on disk stay) and stop the engine. */
  reset(): void {
    this.acknowledged = false
    this.stop()
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  // ------------------------------------------------------------------ guards & prompts

  assertAllowed(window: BmaxWindow | null | undefined): void {
    if (window?.tor) throw new Error(TOR_TORRENT_MESSAGE)
  }

  status(window: BmaxWindow | null | undefined): TorrentsStatus {
    return {
      running: this.proc !== null,
      port: this.port,
      acknowledged: this.acknowledged,
      torDisabled: window?.tor ?? false,
      isDefaultHandler: app.isDefaultProtocolClient('magnet'),
      proxyEnabled: proxyRules(services.settings.get().proxy) !== null,
      folder: this.folder()
    }
  }

  torrents(): TorrentInfo[] {
    return this.list
  }

  /** The IP-exposure warning: shown once per session, before the first torrent is added. */
  async confirmFirstUse(window: BmaxWindow | null): Promise<boolean> {
    if (this.acknowledged) return true
    const proxy = proxyRules(services.settings.get().proxy) !== null
    const options = {
      type: 'warning' as const,
      buttons: ['Cancel', 'I understand, continue'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Torrents are not private',
      message: 'Torrent traffic is NOT routed through Tor and exposes your IP address.',
      detail:
        'Every peer and tracker you connect to can see your real IP address, and which torrents you share. ' +
        'Tor is never used for torrents' +
        (proxy ? ', and the proxy configured in BMAX settings does not apply to them either' : '') +
        '. Use a VPN at the operating-system level if you need to hide your address. Only download content you have the right to share.'
    }
    const { response } = window ? await dialog.showMessageBox(window.base, options) : await dialog.showMessageBox(options)
    if (response !== 1) return false
    this.acknowledged = true
    return true
  }

  // ------------------------------------------------------------------ adding

  async addMagnet(uri: string, window: BmaxWindow | null): Promise<{ id: string } | null> {
    this.assertAllowed(window)
    if (!parseMagnet(uri)) throw new Error('That is not a valid magnet link.')
    if (!(await this.confirmFirstUse(window))) return null
    await this.ensure()
    return this.request<{ id: string }>({ cmd: 'addMagnet', uri: uri.trim() })
  }

  async addTorrentData(data: Uint8Array, window: BmaxWindow | null): Promise<{ id: string } | null> {
    this.assertAllowed(window)
    if (data.length === 0 || data.length > MAX_TORRENT_FILE) throw new Error('That is not a valid .torrent file.')
    if (!(await this.confirmFirstUse(window))) return null
    await this.ensure()
    return this.request<{ id: string }>({ cmd: 'addFile', data })
  }

  async chooseAndAddFile(window: BmaxWindow): Promise<{ id: string } | null> {
    this.assertAllowed(window)
    const res = await dialog.showOpenDialog(window.base, {
      title: 'Open a .torrent file',
      properties: ['openFile'],
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
    })
    const file = res.filePaths[0]
    if (res.canceled || !file) return null
    const buf = readFileSync(file)
    return this.addTorrentData(new Uint8Array(buf), window)
  }

  /** A magnet: link was clicked on a page / given on the command line. */
  async handleMagnet(uri: string, tab: Tab | null, fallbackWindow?: BmaxWindow | null): Promise<void> {
    const window = tab?.window ?? fallbackWindow ?? services.windows.focused()
    try {
      this.assertAllowed(window)
    } catch (err) {
      await this.info(window, 'Torrents are disabled in Tor windows', (err as Error).message)
      return
    }
    try {
      const added = await this.addMagnet(uri, window)
      if (added && window) window.openInternal('torrents')
    } catch (err) {
      await this.info(window, 'Could not add the torrent', (err as Error).message)
    }
  }

  /** A .torrent file was downloaded by the browser engine: hand it to the torrent manager instead of saving it. */
  interceptTorrentDownload(item: DownloadItem, tab: Tab | null): void {
    const window = tab?.window ?? services.windows.focused()
    if (window?.tor) {
      item.cancel()
      void this.info(window, 'Torrents are disabled in Tor windows', TOR_TORRENT_MESSAGE)
      return
    }
    const tmp = join(tmpdir(), `bmax-torrent-${Date.now().toString(36)}.torrent`)
    item.setSavePath(tmp)
    item.once('done', (_e, state) => {
      if (state !== 'completed') return
      void (async () => {
        try {
          const buf = readFileSync(tmp)
          const added = await this.addTorrentData(new Uint8Array(buf), window)
          if (added && window) window.openInternal('torrents')
        } catch (err) {
          await this.info(window, 'Could not add the torrent', (err as Error).message)
        } finally {
          rmSync(tmp, { force: true })
        }
      })()
    })
  }

  private async info(window: BmaxWindow | null | undefined, message: string, detail: string): Promise<void> {
    const options = { type: 'info' as const, buttons: ['OK'], title: 'BMAX', message, detail }
    if (window) await dialog.showMessageBox(window.base, options)
    else await dialog.showMessageBox(options)
  }

  // ------------------------------------------------------------------ control

  async start(id: string, files: number[]): Promise<void> {
    await this.request({ cmd: 'start', torrent: id, files })
  }
  async setFiles(id: string, files: number[]): Promise<void> {
    await this.request({ cmd: 'setFiles', torrent: id, files })
  }

  async action(id: string, action: 'pause' | 'resume' | 'remove' | 'removeFiles'): Promise<void> {
    if (action === 'pause') await this.request({ cmd: 'pause', torrent: id })
    else if (action === 'resume') await this.request({ cmd: 'resume', torrent: id })
    else await this.request({ cmd: 'remove', torrent: id, deleteFiles: action === 'removeFiles' })
  }

  async clearFinished(): Promise<void> {
    if (this.proc) await this.request({ cmd: 'clearFinished' })
  }

  async stream(id: string, file: number): Promise<{ url: string; mime: string }> {
    return this.request({ cmd: 'stream', torrent: id, file })
  }

  /** Open a torrent's folder / a file, but only inside the torrent download folder. */
  openPath(id: string, fileIndex: number | null, reveal: boolean): void {
    const t = this.list.find((x) => x.id === id)
    if (!t) return
    const root = resolve(t.savePath)
    const rel = fileIndex === null ? (t.files.length > 1 || (t.files[0]?.path.includes('/') ?? false) ? t.name : (t.files[0]?.path ?? t.name)) : t.files[fileIndex]?.path
    if (!rel) return
    const target = resolve(root, rel)
    if (!target.startsWith(root + sep) || !existsSync(target)) return
    if (reveal) shell.showItemInFolder(target)
    else void shell.openPath(target)
  }

  setDefaultHandler(enabled: boolean): boolean {
    if (enabled) app.setAsDefaultProtocolClient('magnet')
    else app.removeAsDefaultProtocolClient('magnet')
    return app.isDefaultProtocolClient('magnet')
  }

  /** Test hook: connect a torrent to a peer directly (no DHT/tracker needed). */
  async testAddPeer(id: string, peer: string): Promise<void> {
    await this.request({ cmd: 'addPeer', torrent: id, peer })
  }
}
