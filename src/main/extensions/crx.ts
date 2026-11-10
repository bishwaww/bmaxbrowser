import { extractZip, ZipError } from './zip'

/** Byte offset where the ZIP payload of a .crx (or plain .zip) starts. */
export function zipOffset(buf: Buffer): number {
  if (buf.length < 22) throw new ZipError('The file is too small to be an extension package')
  if (buf.subarray(0, 2).toString('latin1') === 'PK') return 0 // plain zip
  if (buf.subarray(0, 4).toString('latin1') !== 'Cr24') throw new ZipError('Not a Chrome extension package (.crx) or .zip file')
  const version = buf.readUInt32LE(4)
  let offset: number
  if (version === 3) offset = 12 + buf.readUInt32LE(8)
  else if (version === 2) offset = 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12)
  else throw new ZipError(`Unsupported CRX version ${version}`)
  if (!Number.isSafeInteger(offset) || offset >= buf.length) throw new ZipError('Corrupt CRX header')
  return offset
}

/**
 * Unpack a .crx / .zip into an empty folder. The CRX signature is NOT verified (BMAX installs from local files only,
 * not from a store): the install dialog tells the user to install only extensions they trust.
 */
export function extractCrx(buf: Buffer, dest: string): number {
  return extractZip(buf.subarray(zipOffset(buf)), dest)
}
