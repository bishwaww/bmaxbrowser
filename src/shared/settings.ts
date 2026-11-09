import { z } from 'zod'
import { DEFAULT_SEARCH_ENGINE_ID, SEARCH_ENGINES } from './search-engines'
import { NEWTAB_URL } from './internal'

export const tileSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(80),
  url: z.string().max(2048)
})
export type Tile = z.infer<typeof tileSchema>

export const settingsSchema = z.object({
  searchEngine: z.enum(SEARCH_ENGINES.map((e) => e.id) as [string, ...string[]]),
  theme: z.enum(['system', 'light', 'dark']),
  homepage: z.string().max(2048),
  showHomeButton: z.boolean(),
  tiles: z.array(tileSchema).max(24),
  permissions: z.object({
    /** What to do when a site asks and there is no stored decision. */
    defaultAction: z.enum(['ask', 'deny']),
    /** Persist per-site decisions to disk (off: decisions live in memory until the app closes). */
    persist: z.boolean()
  })
})
export type Settings = z.infer<typeof settingsSchema>
export const settingsPatchSchema = settingsSchema.partial()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: DEFAULT_SEARCH_ENGINE_ID,
  theme: 'system',
  homepage: NEWTAB_URL,
  showHomeButton: true,
  tiles: [
    { id: 'ddg', title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
    { id: 'wikipedia', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
    { id: 'github', title: 'GitHub', url: 'https://github.com/' },
    { id: 'osm', title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/' }
  ],
  permissions: { defaultAction: 'ask', persist: false }
}

export interface PrivacyStats {
  adsBlocked: number
  trackersBlocked: number
  /** Estimated milliseconds saved by not loading blocked resources. */
  timeSavedMs: number
}
