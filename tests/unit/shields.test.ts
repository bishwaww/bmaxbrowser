import { describe, expect, it } from 'vitest'
import { resolveOmnibox } from '@shared/omnibox'
import { LIST_CATALOG, listEnabled } from '@shared/shields'
import { DEFAULT_SETTINGS, settingsSchema } from '@shared/settings'

describe('filter list catalog', () => {
  it('has unique ids, https URLs and at least one engine group each', () => {
    const ids = new Set<string>()
    for (const l of LIST_CATALOG) {
      expect(ids.has(l.id), `duplicate ${l.id}`).toBe(false)
      ids.add(l.id)
      expect(l.url.startsWith('https://'), l.id).toBe(true)
      expect(l.groups.length, l.id).toBeGreaterThan(0)
    }
  })

  it('enables every brief-mandated default list and keeps regional lists opt-in', () => {
    const defaults = LIST_CATALOG.filter((l) => l.defaultOn).map((l) => l.id)
    for (const id of [
      'easylist', 'easyprivacy', 'ubo-filters', 'ubo-privacy', 'ubo-badware', 'ubo-annoyances', 'ubo-quick-fixes', 'ubo-unbreak',
      'peter-lowe', 'adguard-base', 'fanboy-annoyances', 'cookie-notices', 'urlhaus'
    ]) {
      expect(defaults, id).toContain(id)
    }
    for (const l of LIST_CATALOG.filter((x) => x.category === 'regional')) expect(l.defaultOn, l.id).toBe(false)
    expect(LIST_CATALOG.some((l) => l.id === 'r-indian')).toBe(true) // South Asia
  })

  it('privacy lists feed the tracker engine and ad lists the ad engine', () => {
    const by = (id: string) => LIST_CATALOG.find((l) => l.id === id)!
    expect(by('easyprivacy').groups).toEqual(['trackers'])
    expect(by('easylist').groups).toEqual(['ads'])
    // exception-heavy lists must reach both engines so "unbreak" rules apply to trackers too
    expect(by('ubo-unbreak').groups).toEqual(expect.arrayContaining(['ads', 'trackers']))
  })

  it('listEnabled honours overrides', () => {
    const easylist = LIST_CATALOG.find((l) => l.id === 'easylist')!
    const indian = LIST_CATALOG.find((l) => l.id === 'r-indian')!
    expect(listEnabled(easylist, {})).toBe(true)
    expect(listEnabled(easylist, { easylist: false })).toBe(false)
    expect(listEnabled(indian, {})).toBe(false)
    expect(listEnabled(indian, { 'r-indian': true })).toBe(true)
  })
})

describe('Shields settings', () => {
  it('defaults protect everything and validate against the schema', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
    const s = DEFAULT_SETTINGS.shields
    expect([s.enabled, s.autoUpdate, s.blockPopups, s.blockRedirects, s.blockNotifications, s.youtube]).toEqual([true, true, true, true, true, true])
    expect(s.disabledSites).toEqual([])
  })
})

describe('omnibox: internal pages keep their query string', () => {
  it('opens Settings on a given section', () => {
    expect(resolveOmnibox('bmax://settings/?section=Shields', 'duckduckgo').url).toBe('bmax://settings/?section=Shields')
    expect(resolveOmnibox('bmax://bookmarks?add=https%3A%2F%2Fa.example&title=x', 'duckduckgo').url).toBe('bmax://bookmarks/?add=https%3A%2F%2Fa.example&title=x')
    expect(resolveOmnibox('bmax://tor', 'duckduckgo').kind).toBe('search') // not user-navigable
  })
})
