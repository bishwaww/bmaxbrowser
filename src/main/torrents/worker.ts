/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Torrent engine. Runs in an Electron utilityProcess (never in a renderer, never in the main process).
 * webtorrent is ESM-only, so it is loaded with a dynamic import().
 *
 * Privacy-relevant defaults: UPnP/NAT-PMP port mapping and LAN peer discovery are OFF unless the user turns them on.
 */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { isSafeTorrentPath, mimeFor, parseMagnet } from '@shared/torrents'
import type { TorrentConfig, TorrentFileInfo, TorrentInfo, TorrentState, WorkerMessage, WorkerRequest } from '@shared/torrents'

const parentPort = (process as unknown as { parentPort: { on(e: 'message', cb: (m: { data: WorkerRequest }) => void): void; postMessage(m: WorkerMessage): void } }).parentPort

interface Meta {
  addedAt: number
  /** user must pick files before anything downloads */
  needsSelection: boolean
  /** file indexes the user wants (applied to webtorrent selections) */
  selection: Set<number>
  paused: boolean
  error?: string
  /** torrent stopped seeding by rule: the final snapshot is kept for the list */
  finishedSnapshot?: TorrentInfo
  savePath: string
}

let client: any = null
let config: TorrentConfig | null = null
const metas = new Map<string, Meta>()
let tick: NodeJS.Timeout | null = null
let httpServer: Server | null = null
let httpPort = 0
const token = randomBytes(18).toString('hex')

function send(m: WorkerMessage): void {
  parentPort.postMessage(m)
}

const kib = (n: number): number => (n > 0 ? Math.round(n * 1024) : -1)

async function ensureClient(): Promise<any> {
  if (client) return client
  if (!config) throw new Error('Torrent engine is not configured')
  const spec = 'webtorrent'
  const mod: any = await import(spec)
  const WebTorrent = mod.default
  client = new WebTorrent({
    maxConns: config.maxConnections,
    dht: config.dht,
    lsd: config.lsd,
    natUpnp: config.upnp,
    natPmp: config.upnp,
    utPex: true,
    // e2e tests run a TCP-only peer in the test process; uTP outgoing attempts would never fall back in time.
    ...(process.env['BMAX_TEST'] === '1' && process.env['BMAX_TORRENT_NO_UTP'] === '1' ? { utp: false } : {}),
    downloadLimit: kib(config.downKBps),
    uploadLimit: kib(config.upKBps),
    userAgent: 'BMAX'
  })
  client.on('error', (err: Error) => console.error('[torrents] client error', err.message))
  client.torrentPort = client.torrentPort || 0
  startTick()
  return client
}

function startTick(): void {
  if (tick) return
  tick = setInterval(pushState, 1000)
}

function applyConfig(cfg: TorrentConfig): void {
  config = cfg
  if (!client) return
  client.maxConns = cfg.maxConnections
  client.throttleDownload(kib(cfg.downKBps))
  client.throttleUpload(kib(cfg.upKBps))
}

// ------------------------------------------------------------------ snapshots

function fileInfos(t: any, meta: Meta): TorrentFileInfo[] {
  return (t.files ?? []).map((f: any, i: number): TorrentFileInfo => ({
    index: i,
    name: f.name,
    path: String(f.path).replace(/\\/g, '/'),
    length: f.length,
    downloaded: f.downloaded,
    progress: f.length ? f.downloaded / f.length : 1,
    selected: meta.needsSelection ? false : meta.selection.has(i)
  }))
}

/** webtorrent's `torrent.done` means EVERY file is complete; with a partial selection we need "all chosen files complete". */
function selectedDone(t: any, meta: Meta): boolean {
  if (meta.needsSelection || meta.selection.size === 0 || !t.files?.length) return false
  return [...meta.selection].every((i) => {
    const f = t.files[i]
    return !f || f.length === 0 || f.done === true
  })
}

function stateOf(t: any, meta: Meta): TorrentState {
  if (meta.error) return 'error'
  if (meta.paused) return 'paused'
  if (!t.ready && !t.files?.length) return 'metadata'
  if (meta.needsSelection) return 'selecting'
  if (selectedDone(t, meta)) return 'seeding'
  return 'downloading'
}

/** Apply the "stop seeding when finished" rule the first time the chosen files are complete. */
function checkFinished(t: any, meta: Meta): void {
  if (meta.finishedSnapshot || !config?.stopSeedingWhenDone || meta.paused || !selectedDone(t, meta)) return
  const snap = snapshot(t, meta)
  snap.state = 'finished'
  snap.downloadSpeed = 0
  snap.uploadSpeed = 0
  snap.numPeers = 0
  meta.finishedSnapshot = snap
  try {
    t.destroy({ destroyStore: false })
  } catch {
    /* ignore */
  }
}

function snapshot(t: any, meta: Meta): TorrentInfo {
  // Size and progress refer to the files the user chose (everything while they are still choosing).
  const files: any[] = t.files ?? []
  const chosen = meta.needsSelection || meta.selection.size === 0 ? files : files.filter((_f, i) => meta.selection.has(i))
  const length = files.length ? chosen.reduce((n, f) => n + f.length, 0) : t.length || 0
  const downloaded = files.length ? chosen.reduce((n, f) => n + f.downloaded, 0) : t.downloaded || 0
  const speed = meta.paused ? 0 : t.downloadSpeed || 0
  const info: TorrentInfo = {
    id: t.infoHash,
    name: t.name || t.infoHash,
    state: stateOf(t, meta),
    length,
    downloaded,
    uploaded: t.uploaded || 0,
    progress: length ? Math.min(1, downloaded / length) : 0,
    downloadSpeed: meta.paused ? 0 : t.downloadSpeed || 0,
    uploadSpeed: meta.paused ? 0 : t.uploadSpeed || 0,
    numPeers: meta.paused ? 0 : t.numPeers || 0,
    // uploaded / downloaded (webtorrent's own ratio counts metadata exchange as uploaded data before anything is downloaded)
    ratio: t.downloaded > 0 ? t.uploaded / t.downloaded : 0,
    eta: speed > 0 && length > downloaded ? Math.round((length - downloaded) / speed) : null,
    files: fileInfos(t, meta),
    savePath: meta.savePath,
    addedAt: meta.addedAt
  }
  if (meta.error) info.error = meta.error
  return info
}

function allSnapshots(): TorrentInfo[] {
  const out: TorrentInfo[] = []
  for (const [id, meta] of metas) {
    if (meta.finishedSnapshot) {
      out.push(meta.finishedSnapshot)
      continue
    }
    const t = client?.torrents.find((x: any) => x.infoHash === id)
    if (t) out.push(snapshot(t, meta))
    else if (meta.error) {
      out.push({ id, name: id, state: 'error', length: 0, downloaded: 0, uploaded: 0, progress: 0, downloadSpeed: 0, uploadSpeed: 0, numPeers: 0, ratio: 0, eta: null, files: [], savePath: meta.savePath, error: meta.error, addedAt: meta.addedAt })
    }
  }
  return out.sort((a, b) => b.addedAt - a.addedAt)
}

function pushState(): void {
  for (const [id, meta] of metas) {
    if (meta.finishedSnapshot) continue
    const t = client?.torrents.find((x: any) => x.infoHash === id)
    if (t) checkFinished(t, meta)
  }
  send({ event: 'state', torrents: allSnapshots(), port: client?.torrentPort ?? 0 })
}

// ------------------------------------------------------------------ torrents

function find(id: string): any {
  const t = client?.torrents.find((x: any) => x.infoHash === id)
  if (!t) throw new Error('Unknown torrent')
  return t
}

function applySelection(t: any, meta: Meta): void {
  if (!t.files?.length) return
  t.files.forEach((f: any, i: number) => {
    if (meta.selection.has(i)) f.select()
    else f.deselect()
  })
}

function wire(t: any, meta: Meta): void {
  t.on('metadata', () => {
    // Torrent metadata is untrusted: refuse anything that could write outside the download folder.
    const bad = (t.files ?? []).find((f: any) => !isSafeTorrentPath(String(f.path)))
    if (bad) {
      meta.error = 'This torrent contains unsafe file paths and was blocked.'
      try {
        t.destroy({ destroyStore: false })
      } catch {
        /* already gone */
      }
      pushState()
      return
    }
    meta.selection = new Set((t.files ?? []).map((_f: any, i: number) => i))
    if (!meta.needsSelection) applySelection(t, meta)
    for (const f of t.files ?? []) {
      f.on('done', () => {
        checkFinished(t, meta)
        pushState()
      })
    }
    pushState()
  })
  t.on('error', (err: Error) => {
    meta.error = err.message
    pushState()
  })
  t.on('done', () => {
    checkFinished(t, meta)
    pushState()
  })
}

async function addTorrent(source: string | Buffer): Promise<{ id: string }> {
  const c = await ensureClient()
  if (!config) throw new Error('not configured')
  const existing = typeof source === 'string' ? parseMagnet(source)?.infoHash : undefined
  if (existing && metas.has(existing)) return { id: existing }
  const savePath = config.folder
  const t: any = await new Promise((resolveAdd, rejectAdd) => {
    try {
      const tor = c.add(source, { path: savePath, deselect: config!.askFiles })
      if (tor.infoHash) return resolveAdd(tor)
      tor.once('infoHash', () => resolveAdd(tor))
      tor.once('error', rejectAdd)
    } catch (err) {
      rejectAdd(err)
    }
  })
  const id: string = t.infoHash
  if (metas.has(id) && metas.get(id)!.finishedSnapshot) metas.delete(id)
  if (!metas.has(id)) {
    const meta: Meta = { addedAt: Date.now(), needsSelection: config.askFiles, selection: new Set(), paused: false, savePath }
    metas.set(id, meta)
    wire(t, meta)
    if (t.files?.length) t.emit('metadata')
  }
  pushState()
  return { id }
}

// ------------------------------------------------------------------ streaming (loopback HTTP, token-protected, Range support)

function startHttp(): Promise<number> {
  if (httpServer) return Promise.resolve(httpPort)
  return new Promise((res) => {
    httpServer = createServer((req, resp) => {
      try {
        const host = String(req.headers.host ?? '')
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return void resp.writeHead(403).end() // DNS-rebinding guard
        if (req.method !== 'GET' && req.method !== 'HEAD') return void resp.writeHead(405).end()
        const m = /^\/s\/([0-9a-f]+)\/([0-9a-f]{40})\/(\d+)(?:\/.*)?$/.exec((req.url ?? '').split('?')[0] ?? '')
        if (!m || m[1] !== token) return void resp.writeHead(403).end()
        const t = client?.torrents.find((x: any) => x.infoHash === m[2])
        const file = t?.files?.[Number(m[3])]
        if (!file) return void resp.writeHead(404).end()
        const size: number = file.length
        let start = 0
        let end = size - 1
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
        const headers: Record<string, string | number> = { 'content-type': mimeFor(file.name), 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
        if (range && (range[1] || range[2])) {
          if (range[1] === '') {
            start = Math.max(0, size - Number(range[2]))
          } else {
            start = Number(range[1])
            if (range[2]) end = Math.min(Number(range[2]), size - 1)
          }
          if (start > end || start >= size) return void resp.writeHead(416, { 'content-range': `bytes */${size}` }).end()
          resp.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
        } else {
          resp.writeHead(200, { ...headers, 'content-length': size })
        }
        if (req.method === 'HEAD') return void resp.end()
        const stream = file.createReadStream({ start, end })
        stream.on('error', () => resp.destroy())
        resp.on('close', () => stream.destroy())
        stream.pipe(resp)
      } catch {
        resp.destroy()
      }
    })
    httpServer.listen(0, '127.0.0.1', () => {
      httpPort = (httpServer!.address() as { port: number }).port
      res(httpPort)
    })
  })
}

// ------------------------------------------------------------------ commands

async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.cmd) {
    case 'init':
      config = req.config
      await ensureClient()
      return { port: client.torrentPort }
    case 'config':
      applyConfig(req.config)
      return null
    case 'addMagnet': {
      if (!parseMagnet(req.uri)) throw new Error('That is not a valid magnet link.')
      return addTorrent(req.uri)
    }
    case 'addFile':
      return addTorrent(Buffer.from(req.data))
    case 'start': {
      const t = find(req.torrent)
      const meta = metas.get(req.torrent)!
      meta.needsSelection = false
      meta.selection = new Set(req.files.filter((i) => Number.isInteger(i) && i >= 0 && i < (t.files?.length ?? 0)))
      if (meta.selection.size === 0) throw new Error('Select at least one file.')
      applySelection(t, meta)
      pushState()
      return null
    }
    case 'setFiles': {
      const t = find(req.torrent)
      const meta = metas.get(req.torrent)!
      meta.selection = new Set(req.files.filter((i) => Number.isInteger(i) && i >= 0 && i < (t.files?.length ?? 0)))
      if (!meta.paused && !meta.needsSelection) applySelection(t, meta)
      pushState()
      return null
    }
    case 'pause': {
      const t = find(req.torrent)
      const meta = metas.get(req.torrent)!
      meta.paused = true
      t.pause()
      // pause() only stops NEW connections: also drop existing peers and stop requesting pieces.
      for (const w of [...(t.wires ?? [])]) w.destroy()
      for (const f of t.files ?? []) f.deselect()
      pushState()
      return null
    }
    case 'resume': {
      const t = find(req.torrent)
      const meta = metas.get(req.torrent)!
      meta.paused = false
      t.resume()
      if (!meta.needsSelection) applySelection(t, meta)
      pushState()
      return null
    }
    case 'remove': {
      const meta = metas.get(req.torrent)
      if (!meta) return null
      const t = client?.torrents.find((x: any) => x.infoHash === req.torrent)
      const name: string = t?.name ?? meta.finishedSnapshot?.name ?? ''
      const files: string[] = (t?.files ?? meta.finishedSnapshot?.files ?? []).map((f: { path: string }) => String(f.path))
      if (t) await new Promise<void>((r) => t.destroy({ destroyStore: false }, () => r()))
      metas.delete(req.torrent)
      if (req.deleteFiles && name) {
        // Delete only inside the download folder, and only what this torrent created.
        const root = resolve(meta.savePath)
        const targets = new Set<string>()
        if (files.length > 1 || (files[0] && files[0].replace(/\\/g, '/').includes('/'))) targets.add(resolve(root, name))
        else if (files[0]) targets.add(resolve(root, files[0]))
        for (const p of targets) {
          if (p.startsWith(root + sep) && p !== root) {
            try {
              rmSync(p, { recursive: true, force: true })
            } catch {
              /* file in use */
            }
          }
        }
      }
      pushState()
      return null
    }
    case 'stream': {
      const t = find(req.torrent)
      const file = t.files?.[req.file]
      if (!file) throw new Error('No such file')
      const port = await startHttp()
      return { url: `http://127.0.0.1:${port}/s/${token}/${t.infoHash}/${req.file}/${encodeURIComponent(file.name)}`, mime: mimeFor(file.name) }
    }
    case 'addPeer': {
      find(req.torrent).addPeer(req.peer)
      return null
    }
    case 'clearFinished': {
      for (const [id, meta] of metas) if (meta.finishedSnapshot || meta.error) metas.delete(id)
      pushState()
      return null
    }
    case 'destroyAll': {
      for (const t of [...(client?.torrents ?? [])]) await new Promise<void>((r) => t.destroy({ destroyStore: false }, () => r()))
      metas.clear()
      pushState()
      return null
    }
  }
}

parentPort.on('message', async (e) => {
  const req = e.data
  try {
    const result = await handle(req)
    send({ event: 'reply', id: req.id, ok: true, result })
  } catch (err) {
    send({ event: 'reply', id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

process.on('uncaughtException', (err) => console.error('[torrents] uncaught', err.message))
process.on('unhandledRejection', (err) => console.error('[torrents] unhandled', err instanceof Error ? err.message : err))
send({ event: 'ready' })
