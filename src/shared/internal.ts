/** Internal page URLs. Pure helpers — no Electron imports. */
export const INTERNAL_SCHEME = 'bmax'
export const INTERNAL_PAGES = ['newtab', 'settings', 'error', 'warning', 'tor', 'bookmarks', 'downloads', 'chrome', 'overlay'] as const
export type InternalPage = (typeof INTERNAL_PAGES)[number]

/** Pages a user can navigate to from the omnibox / links. */
export const NAVIGABLE_PAGES: readonly InternalPage[] = ['newtab', 'settings', 'bookmarks', 'downloads']

export function internalUrl(page: InternalPage, search = ''): string {
  return `${INTERNAL_SCHEME}://${page}/${search}`
}

export function parseInternalUrl(url: string): { page: InternalPage; search: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${INTERNAL_SCHEME}:`) return null
  const page = u.hostname as InternalPage
  if (!INTERNAL_PAGES.includes(page)) return null
  return { page, search: u.search }
}

export function isInternalUrl(url: string): boolean {
  return parseInternalUrl(url) !== null
}

export const NEWTAB_URL = internalUrl('newtab')
