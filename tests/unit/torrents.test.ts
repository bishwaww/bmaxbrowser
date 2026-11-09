import { describe, expect, it } from 'vitest'
import { isSafeTorrentPath, isVideoOrAudio, mimeFor, parseMagnet } from '@shared/torrents'
import { DEFAULT_SETTINGS, settingsSchema } from '@shared/settings'

describe('parseMagnet', () => {
  const HASH = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a'
  it('accepts hex and base32 info hashes and extracts the display name', () => {
    expect(parseMagnet(`magnet:?xt=urn:btih:${HASH}&dn=Some%20Name&tr=udp%3A%2F%2Ftracker.example%3A80`)).toEqual({ infoHash: HASH, name: 'Some Name' })
    expect(parseMagnet(`MAGNET:?xt=urn:btih:${HASH.toUpperCase()}`)?.infoHash).toBe(HASH)
    // base32 form of the same 20 bytes
    expect(parseMagnet('magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK')?.infoHash).toBe(HASH)
  })
  it('rejects everything that is not a well-formed btih magnet link', () => {
    for (const bad of [
      '',
      'http://example.com/?xt=urn:btih:' + HASH,
      'magnet:?dn=no-hash',
      'magnet:?xt=urn:btih:xyz',
      'magnet:?xt=urn:btih:' + HASH.slice(1),
      'magnet:?xt=urn:sha1:' + HASH,
      'magnet:?xt=urn:btih:' + HASH + '&x=' + 'a'.repeat(5000),
      'javascript:alert(1)'
    ]) {
      expect(parseMagnet(bad), bad.slice(0, 40)).toBeNull()
    }
  })
})

describe('isSafeTorrentPath (torrent metadata is untrusted)', () => {
  it('allows ordinary relative paths', () => {
    for (const ok of ['movie.mkv', 'My Album/01 - Intro.mp3', 'a/b/c/d.txt', 'dir/file with spaces (1).txt']) expect(isSafeTorrentPath(ok), ok).toBe(true)
  })
  it('blocks traversal, absolute paths, drive letters and device names', () => {
    for (const bad of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:\\Windows\\system32\\x.dll', 'C:/x', '..\\x', './x', 'a/./b', 'CON', 'dir/nul.txt', 'COM1.txt', 'trailing.', 'bad|name', 'a\0b', '', 'x'.repeat(2000)]) {
      expect(isSafeTorrentPath(bad), JSON.stringify(bad).slice(0, 30)).toBe(false)
    }
  })
})

describe('media helpers', () => {
  it('knows which files can be streamed', () => {
    expect(isVideoOrAudio('a.mp4')).toBe(true)
    expect(isVideoOrAudio('a.MP3')).toBe(true)
    expect(isVideoOrAudio('a.mkv')).toBe(false)
    expect(isVideoOrAudio('a.txt')).toBe(false)
    expect(mimeFor('x.webm')).toBe('video/webm')
    expect(mimeFor('x.unknown')).toBe('application/octet-stream')
  })
})

describe('torrent settings defaults are privacy-first', () => {
  it('validate and keep UPnP and LAN discovery off', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
    const t = DEFAULT_SETTINGS.torrents
    expect(t.upnp).toBe(false)
    expect(t.lsd).toBe(false)
    expect(t.dht).toBe(true)
    expect(t.askFiles).toBe(true)
    expect(t.downKBps).toBe(0)
  })
})
