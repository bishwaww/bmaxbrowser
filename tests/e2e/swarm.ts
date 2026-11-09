import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* eslint-disable @typescript-eslint/no-explicit-any */
const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<any>

export const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

export interface PackFile {
  path: string
  size: number
  /** copy this existing file instead of random bytes */
  from?: string
}

export interface Seeder {
  dir: string
  name: string
  infoHash: string
  magnet: string
  torrentFile: Buffer
  port: number
  files: { path: string; sha256: string; size: number }[]
  client: any
  close(): Promise<void>
}

const OFFLINE = { dht: false, lsd: false, natUpnp: false, natPmp: false, tracker: false, utp: false }

async function newClient(extra: Record<string, unknown> = {}): Promise<any> {
  const mod = await importEsm('webtorrent')
  const client = new mod.default({ ...OFFLINE, ...extra })
  await new Promise<void>((r) => (client.listening ? r() : client.once('listening', () => r())))
  return client
}

/** Create a multi-file torrent from random bytes (and optional real files) and seed it from this process, peer-to-peer only. */
export async function startSeeder(name: string, files: PackFile[]): Promise<Seeder> {
  const root = mkdtempSync(join(tmpdir(), 'bmax-seed-'))
  const dir = join(root, name)
  const infos: Seeder['files'] = []
  for (const f of files) {
    const p = join(dir, ...f.path.split('/'))
    mkdirSync(join(p, '..'), { recursive: true })
    if (f.from) copyFileSync(f.from, p)
    else writeFileSync(p, randomBytes(f.size))
    infos.push({ path: f.path, sha256: sha256(p), size: readFileSync(p).length })
  }
  const client = await newClient()
  const torrent: any = await new Promise((res) => client.seed(dir, { name, announce: [], private: false }, res))
  return {
    dir,
    name,
    infoHash: torrent.infoHash,
    magnet: `magnet:?xt=urn:btih:${torrent.infoHash}&dn=${encodeURIComponent(name)}`,
    torrentFile: Buffer.from(torrent.torrentFile),
    port: client.torrentPort,
    files: infos,
    client,
    close: () => new Promise((r) => client.destroy(() => r()))
  }
}

export interface Leecher {
  client: any
  torrent: any
  dir: string
  close(): Promise<void>
}

/** A second client that downloads from a given peer (used to prove BMAX uploads / seeds). */
export async function startLeecher(magnet: string, peer: string): Promise<Leecher> {
  const dir = mkdtempSync(join(tmpdir(), 'bmax-leech-'))
  const client = await newClient()
  const torrent = client.add(magnet, { path: dir })
  if (torrent.infoHash) torrent.addPeer(peer)
  else torrent.once('infoHash', () => torrent.addPeer(peer))
  return { client, torrent, dir, close: () => new Promise((r) => client.destroy(() => r())) }
}
