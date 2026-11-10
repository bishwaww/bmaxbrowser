import { describe, expect, it } from 'vitest'
import { summarizeManifest } from '../../src/shared/extensions'
import { readingMinutes } from '../../src/shared/reader'
import { settingsSchema, DEFAULT_SETTINGS } from '../../src/shared/settings'
import { formatShortcut, keysToInput, matchShortcut, SHORTCUT_DOCS } from '../../src/shared/shortcuts'
import { parseInternalUrl, NAVIGABLE_PAGES } from '../../src/shared/internal'
import { coerceArticle } from '../../src/main/reader/ReaderManager'

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

describe('Phase 6 settings and pages', () => {
  it('new settings have safe defaults (session restore OFF, site colour scheme follows theme)', () => {
    expect(DEFAULT_SETTINGS.general.restoreSession).toBe(false)
    expect(DEFAULT_SETTINGS.general.sleepTabsAfterMin).toBe(30)
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
