import { crc32, deflateRawSync } from 'node:zlib'

export interface BuildEntry {
  name: string
  data?: Buffer | string
  /** store (0) or deflate (8); default deflate */
  method?: 0 | 8
  /** Claimed uncompressed size (to build zip-bomb style lies) */
  lieSize?: number
  /** Claimed CRC (to build corrupt entries) */
  lieCrc?: number
  flags?: number
}

/** Build a ZIP archive in memory (test helper; deliberately able to produce malformed archives). */
export function buildZip(entries: BuildEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = Buffer.from(e.data ?? '')
    const method = e.method ?? 8
    const comp = method === 8 ? deflateRawSync(data) : data
    const crc = e.lieCrc ?? crc32(data)
    const size = e.lieSize ?? data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(e.flags ?? 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(e.flags ?? 0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, comp)
    centrals.push(central, name)
    offset += 30 + name.length + comp.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

/** Wrap a zip in a CRX3 container (header content is arbitrary: BMAX does not verify signatures). */
export function buildCrx3(zip: Buffer): Buffer {
  const header = Buffer.from('not-a-real-signature-block')
  const prefix = Buffer.alloc(12)
  prefix.write('Cr24', 0, 'latin1')
  prefix.writeUInt32LE(3, 4)
  prefix.writeUInt32LE(header.length, 8)
  return Buffer.concat([prefix, header, zip])
}

/** CRX2 container. */
export function buildCrx2(zip: Buffer): Buffer {
  const key = Buffer.from('pubkey')
  const sig = Buffer.from('sig-sig')
  const prefix = Buffer.alloc(16)
  prefix.write('Cr24', 0, 'latin1')
  prefix.writeUInt32LE(2, 4)
  prefix.writeUInt32LE(key.length, 8)
  prefix.writeUInt32LE(sig.length, 12)
  return Buffer.concat([prefix, key, sig, zip])
}
