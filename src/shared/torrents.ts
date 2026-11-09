/** Torrent types shared by main, worker and UI (no Electron / Node imports). */

export type TorrentState = 'metadata' | 'selecting' | 'downloading' | 'seeding' | 'paused' | 'finished' | 'error'

export interface TorrentFileInfo {
  index: number
  name: string
  /** path inside the torrent, forward slashes */
  path: string
  length: number
  downloaded: number
  progress: number
  selected: boolean
}

export interface TorrentInfo {
  /** info hash, lowercase hex */
  id: string
  name: string
  state: TorrentState
  length: number
  downloaded: number
  uploaded: number
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  ratio: number
  /** seconds, null unknown */
  eta: number | null
  files: TorrentFileInfo[]
  savePath: string
  error?: string | undefined
  addedAt: number
}

export interface TorrentConfig {
  folder: string
  /** KiB/s, 0 = unlimited */
  downKBps: number
  upKBps: number
  maxConnections: number
  stopSeedingWhenDone: boolean
  askFiles: boolean
  dht: boolean
  lsd: boolean
  upnp: boolean
}

export interface TorrentsStatus {
  running: boolean
  /** the port the engine listens on for incoming peers (0 = not running) */
  port: number
  /** the user has confirmed the IP-exposure warning in this session */
  acknowledged: boolean
  /** this window is a Tor window: torrents are disabled */
  torDisabled: boolean
  isDefaultHandler: boolean
  proxyEnabled: boolean
  folder: string
}

/** Validate a magnet link: btih info hash (40 hex or 32 base32), bounded length, nothing but a magnet URI. */
export function parseMagnet(uri: string): { infoHash: string; name: string | null } | null {
  const s = uri.trim()
  if (s.length > 4096 || !/^magnet:\?/i.test(s)) return null
  let params: URLSearchParams
  try {
    params = new URL(s).searchParams
  } catch {
    return null
  }
  const xt = params.getAll('xt').find((x) => /^urn:btih:/i.test(x))
  if (!xt) return null
  const hash = xt.slice('urn:btih:'.length)
  if (/^[0-9a-f]{40}$/i.test(hash)) return { infoHash: hash.toLowerCase(), name: params.get('dn') }
  if (/^[a-z2-7]{32}$/i.test(hash)) return { infoHash: base32ToHex(hash), name: params.get('dn') }
  return null
}

function base32ToHex(b32: string): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let bits = ''
  for (const c of b32.toLowerCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  let hex = ''
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex.slice(0, 40)
}

/** A path inside a torrent must be relative and never climb out of the download folder (torrent metadata is untrusted). */
export function isSafeTorrentPath(path: string): boolean {
  if (!path || path.length > 1024) return false
  const p = path.replace(/\\/g, '/')
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\0')) return false
  const parts = p.split('/')
  if (parts.some((s) => s === '..' || s === '.')) return false
  // Windows reserved device names / trailing dots would alias other files
  if (parts.some((s) => /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s) || /[. ]$/.test(s) || /[<>:"|?*]/.test(s))) return false
  return true
}

export function isVideoOrAudio(name: string): boolean {
  return /\.(mp4|m4v|webm|ogv|mov|mp3|m4a|ogg|oga|opus|wav|flac|aac)$/i.test(name)
}

export const STREAM_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac'
}

export function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return STREAM_MIME[ext] ?? 'application/octet-stream'
}

// ------------------------------------------------------------------ main <-> worker protocol

export type WorkerRequest =
  | { id: number; cmd: 'init'; config: TorrentConfig }
  | { id: number; cmd: 'config'; config: TorrentConfig }
  | { id: number; cmd: 'addMagnet'; uri: string }
  | { id: number; cmd: 'addFile'; data: Uint8Array }
  | { id: number; cmd: 'start'; torrent: string; files: number[] }
  | { id: number; cmd: 'setFiles'; torrent: string; files: number[] }
  | { id: number; cmd: 'pause'; torrent: string }
  | { id: number; cmd: 'resume'; torrent: string }
  | { id: number; cmd: 'remove'; torrent: string; deleteFiles: boolean }
  | { id: number; cmd: 'stream'; torrent: string; file: number }
  | { id: number; cmd: 'addPeer'; torrent: string; peer: string }
  | { id: number; cmd: 'clearFinished' }
  | { id: number; cmd: 'destroyAll' }

export type WorkerMessage =
  | { event: 'ready' }
  | { event: 'state'; torrents: TorrentInfo[]; port: number }
  | { event: 'reply'; id: number; ok: true; result: unknown }
  | { event: 'reply'; id: number; ok: false; error: string }
