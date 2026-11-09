export interface SearchEngine {
  id: string
  name: string
  /** `%s` is replaced by the encoded query. */
  url: string
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/dsearch?query=%s' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' }
]

export const DEFAULT_SEARCH_ENGINE_ID = 'duckduckgo'

export function getSearchEngine(id: string): SearchEngine {
  return SEARCH_ENGINES.find((e) => e.id === id) ?? SEARCH_ENGINES[0]!
}

export function searchUrl(engineId: string, query: string): string {
  return getSearchEngine(engineId).url.replace('%s', encodeURIComponent(query))
}
