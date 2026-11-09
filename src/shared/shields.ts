/** Shared Shields types and the filter-list catalog (pure data, no Electron imports). */

export type ListCategory = 'ads' | 'privacy' | 'annoyances' | 'cookies' | 'malware' | 'regional'
/** Which compiled engine a list belongs to: matching trackers first lets us count ads and trackers separately. */
export type EngineGroup = 'ads' | 'trackers'

export interface ListDef {
  id: string
  name: string
  url: string
  category: ListCategory
  defaultOn: boolean
  groups: EngineGroup[]
  /** Short publisher note shown in settings. */
  note?: string
}

const UBO = 'https://ublockorigin.github.io/uAssets/filters'
const ABP = 'https://easylist-downloads.adblockplus.org'

export const LIST_CATALOG: readonly ListDef[] = [
  { id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt', category: 'ads', defaultOn: true, groups: ['ads'] },
  { id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt', category: 'privacy', defaultOn: true, groups: ['trackers'] },
  { id: 'ubo-filters', name: 'uBlock Origin – Filters (ads)', url: `${UBO}/filters.min.txt`, category: 'ads', defaultOn: true, groups: ['ads'] },
  { id: 'ubo-privacy', name: 'uBlock Origin – Privacy', url: `${UBO}/privacy.min.txt`, category: 'privacy', defaultOn: true, groups: ['trackers'] },
  { id: 'ubo-badware', name: 'uBlock Origin – Badware risks', url: `${UBO}/badware.min.txt`, category: 'malware', defaultOn: true, groups: ['trackers'] },
  { id: 'ubo-annoyances', name: 'uBlock Origin – Annoyances', url: `${UBO}/annoyances.min.txt`, category: 'annoyances', defaultOn: true, groups: ['ads'] },
  { id: 'ubo-quick-fixes', name: 'uBlock Origin – Quick fixes (incl. YouTube)', url: `${UBO}/quick-fixes.min.txt`, category: 'ads', defaultOn: true, groups: ['ads', 'trackers'] },
  { id: 'ubo-unbreak', name: 'uBlock Origin – Unbreak', url: `${UBO}/unbreak.min.txt`, category: 'ads', defaultOn: true, groups: ['ads', 'trackers'] },
  {
    id: 'peter-lowe',
    name: "Peter Lowe's Ad and tracking server list",
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',
    category: 'ads',
    defaultOn: true,
    groups: ['ads']
  },
  { id: 'adguard-base', name: 'AdGuard Base', url: 'https://filters.adtidy.org/extension/ublock/filters/2.txt', category: 'ads', defaultOn: true, groups: ['ads'], note: 'Large list (~6 MB)' },
  { id: 'fanboy-annoyances', name: "Fanboy's Annoyances", url: 'https://secure.fanboy.co.nz/fanboy-annoyance.txt', category: 'annoyances', defaultOn: true, groups: ['ads'] },
  { id: 'cookie-notices', name: "Fanboy's Cookiemonster (cookie-consent banners)", url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt', category: 'cookies', defaultOn: true, groups: ['ads'] },
  {
    id: 'urlhaus',
    name: 'URLhaus malware URLs (via malware-filter)',
    url: 'https://curbengh.github.io/malware-filter/urlhaus-filter-online.txt',
    category: 'malware',
    defaultOn: true,
    groups: ['trackers'],
    note: 'abuse.ch URLhaus data, mirrored by the malware-filter project'
  },

  // Regional lists (off by default)
  { id: 'r-indian', name: 'IndianList (India / South Asia)', url: `${ABP}/indianlist.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-china', name: 'EasyList China', url: `${ABP}/easylistchina.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-germany', name: 'EasyList Germany', url: `${ABP}/easylistgermany.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-france', name: 'Liste FR (France)', url: `${ABP}/liste_fr.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-dutch', name: 'EasyList Dutch', url: `${ABP}/easylistdutch.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-italy', name: 'EasyList Italy', url: `${ABP}/easylistitaly.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-spanish', name: 'EasyList Spanish', url: `${ABP}/easylistspanish.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-portuguese', name: 'EasyList Portuguese', url: `${ABP}/easylistportuguese.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-polish', name: 'EasyList Polish', url: `${ABP}/easylistpolish.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-russian', name: 'RU AdList (Russian)', url: `${ABP}/advblock.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-bulgarian', name: 'Bulgarian list', url: `${ABP}/bulgarian_list.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-israel', name: 'EasyList Hebrew (Israel)', url: `${ABP}/israellist.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-lithuania', name: 'EasyList Lithuania', url: `${ABP}/easylistlithuania.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-czech', name: 'EasyList Czech and Slovak', url: `${ABP}/easylistczechslovak.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-korean', name: 'Korean list', url: `${ABP}/koreanlist.txt`, category: 'regional', defaultOn: false, groups: ['ads'] },
  { id: 'r-indonesia', name: 'ABPindo (Indonesia)', url: `${ABP}/abpindo.txt`, category: 'regional', defaultOn: false, groups: ['ads'] }
]

export const RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'

export function listEnabled(def: ListDef, overrides: Record<string, boolean>): boolean {
  return overrides[def.id] ?? def.defaultOn
}

export type BlockCategory = 'ad' | 'tracker' | 'custom'

export interface BlockedItem {
  host: string
  type: string
  category: BlockCategory
  redirected?: boolean
}

export interface BlockedNavigation {
  kind: 'popup' | 'redirect'
  url: string
}

export interface ShieldsPanelInfo {
  tabId: number | null
  site: string
  /** http(s) page where Shields applies. */
  supported: boolean
  globalEnabled: boolean
  siteEnabled: boolean
  blocked: number
  ads: number
  trackers: number
  customHidden: number
  items: BlockedItem[]
  navigations: BlockedNavigation[]
  notificationsBlocked: number
  lifetime: { adsBlocked: number; trackersBlocked: number; timeSavedMs: number }
  engine: EngineStatus
}

export interface EngineStatus {
  state: 'idle' | 'loading' | 'building' | 'ready' | 'offline' | 'error'
  message: string
  /** epoch ms of the last successful engine build, 0 if never */
  builtAt: number
  networkRules: number
  cosmeticRules: number
}

export interface ListStatus {
  id: string
  name: string
  category: ListCategory
  enabled: boolean
  note?: string | undefined
  /** epoch ms, 0 = not downloaded yet */
  fetchedAt: number
  bytes: number
}

export interface ShieldsListsInfo {
  lists: ListStatus[]
  engine: EngineStatus
  updating: boolean
}
