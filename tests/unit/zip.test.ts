import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractCrx, zipOffset } from '../../src/main/extensions/crx'
import { extractZip, readZip, safeEntryName, ZipError } from '../../src/main/extensions/zip'
import { buildCrx2, buildCrx3, buildZip } from '../helpers/zip-builder'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'bmax-zip-test-'))
const cleanup = (d: string): void => rmSync(d, { recursive: true, force: true })

describe('safeEntryName', () => {
  it('accepts ordinary relative paths and normalises separators', () => {
    expect(safeEntryName('manifest.json')).toBe('manifest.json')
    expect(safeEntryName('js/content.js')).toBe('js/content.js')
    expect(safeEntryName('./icons/a.png')).toBe('icons/a.png')
    expect(safeEntryName('dir/')).toBe('dir/')
    expect(safeEntryName('win\\style\\a.js')).toBe('win/style/a.js')
  })
  it('rejects anything that could escape the destination', () => {
    for (const bad of ['../evil.js', 'a/../../evil.js', '/abs.js', 'C:/evil.js', 'c:\\evil.js', '..\\evil.js', 'a//b', 'x\0y', '']) {
      expect(safeEntryName(bad), bad).toBeNull()
    }
  })
})

describe('readZip / extractZip', () => {
  it('round-trips stored and deflated files', () => {
    const zip = buildZip([
      { name: 'manifest.json', data: '{"a":1}' },
      { name: 'dir/' },
      { name: 'dir/big.txt', data: 'x'.repeat(10_000) },
      { name: 'raw.bin', data: Buffer.from([1, 2, 3]), method: 0 }
    ])
    const entries = readZip(zip)
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'dir/', 'dir/big.txt', 'raw.bin'])
    expect(entries[2]!.read().length).toBe(10_000)
    const dest = tmp()
    try {
      expect(extractZip(zip, dest)).toBe(3)
      expect(readFileSync(join(dest, 'manifest.json'), 'utf8')).toBe('{"a":1}')
      expect(readFileSync(join(dest, 'dir', 'big.txt'), 'utf8')).toHaveLength(10_000)
    } finally {
      cleanup(dest)
    }
  })

  it('refuses path traversal ("zip slip") and writes nothing outside the destination', () => {
    const dest = tmp()
    try {
      const zip = buildZip([{ name: '../escaped.txt', data: 'pwn' }])
      expect(() => extractZip(zip, dest)).toThrow(ZipError)
      expect(existsSync(join(dest, '..', 'escaped.txt'))).toBe(false)
    } finally {
      cleanup(dest)
    }
  })

  it('refuses encrypted entries, unsupported methods and ZIP64', () => {
    expect(() => readZip(buildZip([{ name: 'a', data: 'x', flags: 1 }]))).toThrow(/Encrypted/)
    const zip = buildZip([{ name: 'a', data: 'x' }])
    zip.writeUInt16LE(12, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10) // bzip2
    expect(() => readZip(zip)).toThrow(/compression method/)
    const z64 = buildZip([{ name: 'a', data: 'x' }])
    z64.writeUInt32LE(0xffffffff, z64.length - 22 + 16)
    expect(() => readZip(z64)).toThrow(/ZIP64/)
  })

  it('stops zip bombs: declared sizes are limited and actual output may not exceed them', () => {
    const big = buildZip([{ name: 'bomb.bin', data: Buffer.alloc(2_000_000) }])
    expect(() => readZip(big, { maxEntries: 10, maxFileBytes: 1000, maxTotalBytes: 1e9 })).toThrow(/too large/)
    expect(() => readZip(big, { maxEntries: 10, maxFileBytes: 1e9, maxTotalBytes: 1000 })).toThrow(/too much/)
    expect(() => readZip(buildZip([{ name: 'a' }, { name: 'b' }, { name: 'c' }]), { maxEntries: 2, maxFileBytes: 10, maxTotalBytes: 100 })).toThrow(/Too many/)
    // The directory claims 10 bytes but the data inflates to 2 MB.
    const liar = buildZip([{ name: 'lie.bin', data: Buffer.alloc(2_000_000), lieSize: 10 }])
    expect(() => readZip(liar)[0]!.read()).toThrow(ZipError)
  })

  it('detects corrupt data via CRC and size', () => {
    const bad = buildZip([{ name: 'a.txt', data: 'hello world', lieCrc: 1234 }])
    expect(() => readZip(bad)[0]!.read()).toThrow(/Checksum/)
    expect(() => readZip(Buffer.from('definitely not a zip file at all'))).toThrow(ZipError)
  })
})

describe('CRX', () => {
  const zip = buildZip([{ name: 'manifest.json', data: '{"name":"x"}' }])
  it('finds the zip payload in CRX3, CRX2 and plain zip files', () => {
    expect(zipOffset(buildCrx3(zip))).toBe(12 + 'not-a-real-signature-block'.length)
    expect(zipOffset(buildCrx2(zip))).toBe(16 + 'pubkey'.length + 'sig-sig'.length)
    expect(zipOffset(zip)).toBe(0)
  })
  it('extracts a CRX3 package', () => {
    const dest = tmp()
    try {
      expect(extractCrx(buildCrx3(zip), dest)).toBe(1)
      expect(readFileSync(join(dest, 'manifest.json'), 'utf8')).toBe('{"name":"x"}')
    } finally {
      cleanup(dest)
    }
  })
  it('rejects other files and bad headers', () => {
    expect(() => zipOffset(Buffer.from('MZ'.repeat(40)))).toThrow(/Not a Chrome extension/)
    const v9 = buildCrx3(zip)
    v9.writeUInt32LE(9, 4)
    expect(() => zipOffset(v9)).toThrow(/Unsupported CRX version/)
    const huge = buildCrx3(zip)
    huge.writeUInt32LE(0x7fffffff, 8)
    expect(() => zipOffset(huge)).toThrow(/Corrupt CRX/)
  })
})
