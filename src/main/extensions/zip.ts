import { crc32, inflateRawSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * Minimal, defensive ZIP reader for extension packages (CRX payloads and .zip files). Untrusted input:
 * no zip64, no encryption, no path escapes, and hard limits on entry count and expanded size (zip bombs).
 */
export interface ZipLimits {
  maxEntries: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 10_000, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 250 * 1024 * 1024 }

export interface ZipEntry {
  /** Normalised relative path with forward slashes (directories end with '/'). */
  name: string
  isDir: boolean
  size: number
  read(): Buffer
}

export class ZipError extends Error {}

/** A safe relative path, or null when the name could escape the destination or is otherwise suspicious. */
export function safeEntryName(raw: string): string | null {
  if (raw.length === 0 || raw.length > 500 || raw.includes('\0')) return null
  const name = raw.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null
  const segments = name.split('/')
  if (segments.some((s, i) => s === '..' || (s === '' && i < segments.length - 1))) return null
  return name
}

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  if (buf.length < 22) throw new ZipError('Not a ZIP archive')
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP archive (no end-of-directory record)')
  const total = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported')
  if (total > limits.maxEntries) throw new ZipError('Too many files in the archive')
  if (cdOffset + cdSize > buf.length) throw new ZipError('Corrupt ZIP directory')

  const entries: ZipEntry[] = []
  let pos = cdOffset
  let expanded = 0
  for (let n = 0; n < total; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) throw new ZipError('Corrupt ZIP directory entry')
    const flags = buf.readUInt16LE(pos + 8)
    const method = buf.readUInt16LE(pos + 10)
    const crc = buf.readUInt32LE(pos + 16)
    const compSize = buf.readUInt32LE(pos + 20)
    const size = buf.readUInt32LE(pos + 24)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    if (pos + 46 + nameLen > buf.length) throw new ZipError('Corrupt ZIP directory entry')
    const rawName = buf.toString('utf8', pos + 46, pos + 46 + nameLen)
    pos += 46 + nameLen + extraLen + commentLen

    if (flags & 1) throw new ZipError('Encrypted ZIP entries are not supported')
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported')
    const name = safeEntryName(rawName)
    if (name === null) throw new ZipError(`Unsafe file name in archive: ${rawName.slice(0, 80)}`)
    const isDir = name.endsWith('/')
    if (!isDir) {
      if (method !== 0 && method !== 8) throw new ZipError(`Unsupported compression method ${method}`)
      if (size > limits.maxFileBytes) throw new ZipError(`File too large in archive: ${name}`)
      expanded += size
      if (expanded > limits.maxTotalBytes) throw new ZipError('Archive expands to too much data')
    }
    entries.push({
      name,
      isDir,
      size,
      read: () => {
        if (isDir) return Buffer.alloc(0)
        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG) throw new ZipError(`Corrupt local header for ${name}`)
        const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
        if (start + compSize > buf.length) throw new ZipError(`Truncated data for ${name}`)
        const raw = buf.subarray(start, start + compSize)
        let out: Buffer
        if (method === 0) out = Buffer.from(raw)
        else {
          try {
            // maxOutputLength: a lying directory entry cannot make us inflate more than it declared.
            out = inflateRawSync(raw, { maxOutputLength: Math.max(1, size) })
          } catch {
            throw new ZipError(`Could not decompress ${name}`)
          }
        }
        if (out.length !== size) throw new ZipError(`Size mismatch for ${name}`)
        if (crc32(out) !== crc) throw new ZipError(`Checksum mismatch for ${name}`)
        return out
      }
    })
  }
  return entries
}

/** Extract into `dest` (which must already be a fresh, empty folder). Never writes outside it. */
export function extractZip(buf: Buffer, dest: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): number {
  const root = resolve(dest)
  let files = 0
  for (const e of readZip(buf, limits)) {
    const target = resolve(join(root, ...e.name.split('/')))
    if (target !== root && !target.startsWith(root + sep)) throw new ZipError(`Unsafe file name in archive: ${e.name.slice(0, 80)}`)
    if (e.isDir) {
      mkdirSync(target, { recursive: true })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, e.read(), { flag: 'wx' })
    files++
  }
  return files
}
