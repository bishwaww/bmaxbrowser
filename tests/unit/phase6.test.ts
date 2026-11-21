import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { isolateScriptlet } from '../../src/shared/shields'
import { summarizeManifest } from '../../src/shared/extensions'
import { readingMinutes } from '../../src/shared/reader'
import { settingsSchema, DEFAULT_SETTINGS } from '../../src/shared/settings'
import { formatShortcut, keysToInput, matchShortcut, SHORTCUT_DOCS } from '../../src/shared/shortcuts'
import { parseInternalUrl, NAVIGABLE_PAGES } from '../../src/shared/internal'
import { coerceArticle } from '../../src/main/reader/ReaderManager'
import { siteHost, sniffImageType } from '../../src/main/tabs/favicon'
import { updateErrorText } from '../../src/main/updates/UpdateManager'
// @ts-expect-error plain .mjs build script without type declarations
import { nextVersion } from '../../scripts/next-version.mjs'

describe('Settings → Shortcuts list', () => {
  it('every documented shortcut really triggers its command (Windows/Linux and macOS)', () => {
    for (const platform of ['win32', 'darwin']) {
      for (const doc of SHORTCUT_DOCS) {
        expect(matchShortcut(keysToInput(doc.keys, platform), platform), `${doc.label} on ${platform}`).toBe(doc.command)
      }
    }
  })
  it('has no duplicate key combinations', () => {
    const keys = SHORTCUT_DOCS.map((d) => d.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('formats for each platform', () => {
    expect(formatShortcut('Mod+Shift+T', 'win32')).toBe('Ctrl+Shift+T')
    expect(formatShortcut('Mod+Shift+T', 'darwin')).toBe('⌘⇧T')
    expect(formatShortcut('Mod+Alt+R', 'darwin')).toBe('⌘⌥R')
  })
  it('reader mode and picture-in-picture shortcuts', () => {
    expect(matchShortcut({ key: 'r', control: true, alt: true, shift: false, meta: false }, 'win32')).toBe('readerMode')
    expect(matchShortcut({ key: 'p', control: true, alt: true, shift: false, meta: false }, 'win32')).toBe('pictureInPicture')
  })
})

describe('extension manifest summary', () => {
  it('summarises permissions in plain language and flags all-sites access', () => {
    const s = summarizeManifest({
      manifest_version: 3,
      name: 'Demo',
      version: '1.2.3',
      description: 'does things',
      permissions: ['storage', 'cookies', 'weirdThing'],
      host_permissions: ['https://*/*'],
      content_scripts: [{ matches: ['https://example.com/*'], js: ['c.js'] }],
      action: { default_popup: 'popup.html' },
      options_ui: { page: '/options.html' }
    })
    expect(s.allSites).toBe(true)
    expect(s.permissions[0]).toMatch(/ALL websites/)
    expect(s.permissions.join('|')).toMatch(/cookies/i)
    expect(s.permissions.join('|')).toMatch(/weirdThing/)
    expect(s.popupPage).toBe('popup.html')
    expect(s.optionsPage).toBe('options.html')
  })
  it('lists specific hosts when not all sites', () => {
    const s = summarizeManifest({ manifest_version: 2, name: 'X', version: '1', permissions: ['https://a.example/*'] })
    expect(s.allSites).toBe(false)
    expect(s.permissions[0]).toContain('a.example')
  })
  it('rejects unusable manifests and unsafe page paths', () => {
    expect(() => summarizeManifest(null)).toThrow()
    expect(() => summarizeManifest({ manifest_version: 1, name: 'x' })).toThrow(/manifest_version/)
    expect(() => summarizeManifest({ manifest_version: 3 })).toThrow(/no name/)
    const s = summarizeManifest({ manifest_version: 3, name: 'x', action: { default_popup: '../../etc/passwd' }, options_page: 'https://evil.example/x.html' })
    expect(s.popupPage).toBeNull()
    expect(s.optionsPage).toBeNull()
  })
})

describe('reader mode data', () => {
  it('coerces what the page returned and rejects junk', () => {
    expect(coerceArticle(null, 'https://x.example/')).toBeNull()
    expect(coerceArticle({ html: '' }, 'https://x.example/')).toBeNull()
    expect(coerceArticle({ html: 'x'.repeat(5_000_000) }, 'https://x.example/')).toBeNull()
    const a = coerceArticle({ title: 't'.repeat(1000), html: '<p>hi</p>', dir: 'sideways', words: 'many', byline: 5 }, 'https://x.example/a')!
    expect(a.title).toHaveLength(300)
    expect(a.dir).toBe('')
    expect(a.words).toBe(0)
    expect(a.byline).toBe('')
    expect(a.url).toBe('https://x.example/a')
  })
  it('estimates reading time', () => {
    expect(readingMinutes(0)).toBe(1)
    expect(readingMinutes(1000)).toBe(5)
  })
})

describe('Shields scriptlets', () => {
  // Shape of the scriptlets in the uBlock lists: shared helpers as top-level declarations, then the call.
  const a = 'class JSONPath { static id() { return 1 } }\nfunction helper() { return "a" }\nglobalThis.ranA = helper() + JSONPath.id()'
  const b = 'class JSONPath { static id() { return 2 } }\nfunction helper() { return "b" }\nglobalThis.ranB = helper() + JSONPath.id()'
  const page = 'var helper = "the page\'s own global"'
  it('run as they are, the second scriptlet that shares a helper class cannot even be parsed', () => {
    const ctx: Record<string, unknown> = {}
    runInNewContext(a, ctx)
    expect(() => runInNewContext(b, ctx)).toThrow(/JSONPath.*already been declared/)
  })
  it('isolated, every scriptlet runs and none of them touches the page globals', () => {
    const ctx: Record<string, unknown> = {}
    runInNewContext(page, ctx)
    runInNewContext(isolateScriptlet(a), ctx)
    runInNewContext(isolateScriptlet(b), ctx)
    expect(ctx['ranA']).toBe('a1')
    expect(ctx['ranB']).toBe('b2')
    expect(ctx['helper']).toBe("the page's own global")
    expect(ctx['JSONPath']).toBeUndefined()
  })
  it('a scriptlet that throws does not break the page', () => {
    expect(() => runInNewContext(isolateScriptlet('decodeURIComponent("%E0%A4%A")'), {})).not.toThrow()
  })
})

describe('site icons', () => {
  it('recognises icon formats by their first bytes (servers often send no usable content type)', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png')
    expect(sniffImageType(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon')
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageType(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
    expect(sniffImageType(Buffer.from('<!doctype html><title>Not found</title>'))).toBeNull()
    expect(sniffImageType(Buffer.alloc(0))).toBeNull()
  })
  it('groups icons by site', () => {
    expect(siteHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(siteHost('http://m.example.org:8080/x')).toBe('m.example.org')
    expect(siteHost('bmax://newtab/')).toBe('')
    expect(siteHost('not a url')).toBe('')
  })
})

describe('updates', () => {
  it('each release gets the next free patch number above package.json and above every published release', () => {
    expect(nextVersion(0, 6, 0, [])).toBe('0.6.0')
    expect(nextVersion(0, 6, 0, ['v0.6.0'])).toBe('0.6.1')
    expect(nextVersion(0, 6, 0, ['v0.6.0', 'v0.6.7', 'v0.6.3', 'v0.5.99', 'nightly'])).toBe('0.6.8')
    expect(nextVersion(0, 7, 0, ['v0.6.9'])).toBe('0.7.0')
    expect(nextVersion(1, 0, 5, ['v1.0.2'])).toBe('1.0.5')
  })
  it('explains update errors in plain words', () => {
    expect(updateErrorText(new Error('HttpError: 404 Not Found\n"method: GET url: https://github.com/x/y/releases.atom"'), 'x')).toMatch(/No published version/)
    expect(updateErrorText(new Error('Cannot find latest.yml in the latest release artifacts'), 'x')).toMatch(/No published version/)
    expect(updateErrorText(new Error('net::ERR_INTERNET_DISCONNECTED'), 'x')).toMatch(/internet connection/)
    expect(updateErrorText(new Error('sha512 checksum mismatch\nstack…'), 'x')).toBe('sha512 checksum mismatch')
    expect(updateErrorText(null, 'Update check failed')).toBe('Update check failed')
  })
})

describe('Phase 6 settings and pages', () => {
  it('new settings have safe defaults (session restore OFF, site colour scheme follows theme)', () => {
    expect(DEFAULT_SETTINGS.general.restoreSession).toBe(false)
    expect(DEFAULT_SETTINGS.general.sleepTabsAfterMin).toBe(15)
    expect(DEFAULT_SETTINGS.siteColorScheme).toBe('follow')
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
  })
  it('rejects out-of-range values', () => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, reader: { font: 'serif', size: 99, theme: 'auto' } }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, sleepTabsAfterMin: -1 } }).success).toBe(false)
  })
  it('privacy page is navigable; the reader page is not typed by hand', () => {
    expect(parseInternalUrl('bmax://privacy/')?.page).toBe('privacy')
    expect(NAVIGABLE_PAGES).toContain('privacy')
    expect(NAVIGABLE_PAGES).not.toContain('reader')
  })
})
