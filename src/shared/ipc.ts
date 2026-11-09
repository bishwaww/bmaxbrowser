import { z } from 'zod'
import { settingsPatchSchema } from './settings'
import type { Settings, PrivacyStats } from './settings'
import type { CertInfo, OverlayKind, Rect, TorState, WindowState } from './types'
import type { Bookmark, PasswordEntry, VaultStatus } from './vault'
import type { ShieldsListsInfo, ShieldsPanelInfo } from './shields'

export interface VaultResult {
  ok: boolean
  error?: string | undefined
}

export { IPC_CMD, IPC_PUSH } from './channels'

const id = z.number().int().nonnegative()
const url = z.string().max(8192)
const rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const kind = z.enum(['menu', 'cert', 'permission', 'find', 'suggest', 'shields'])
const empty = z.object({}).strict().optional()

/** zod schema per command. Every IPC message is parsed against these in the main process. */
export const commandSchemas = {
  'tab.new': z.object({ url: url.optional(), background: z.boolean().optional() }).optional(),
  'tab.newContainer': z.object({ url: url.optional() }).optional(),
  'tab.close': z.object({ id }),
  'tab.activate': z.object({ id }),
  'tab.move': z.object({ id, index: z.number().int().min(0).max(1000) }),
  'tab.pin': z.object({ id, pinned: z.boolean() }),
  'tab.mute': z.object({ id, muted: z.boolean() }),
  'tab.duplicate': z.object({ id }),
  'tab.closeOthers': z.object({ id }),
  'tab.closeRight': z.object({ id }),
  'tab.tearOff': z.object({ id, screenX: z.number(), screenY: z.number() }),
  'tab.contextMenu': z.object({ id }),
  'nav.go': z.object({ input: z.string().max(8192), newTab: z.boolean().optional() }),
  'nav.back': empty,
  'nav.forward': empty,
  'nav.reload': z.object({ hard: z.boolean().optional() }).optional(),
  'nav.stop': empty,
  'nav.home': empty,
  'window.action': z.object({
    name: z.enum([
      'newWindow',
      'newIsolatedWindow',
      'print',
      'savePage',
      'viewSource',
      'devtools',
      'fullscreen',
      'find',
      'settings',
      'zoomIn',
      'zoomOut',
      'zoomReset',
      'newTorWindow',
      'burn',
      'bookmarkPage'
    ])
  }),
  'overlay.show': z.object({ kind, rect, data: z.unknown().optional() }),
  'overlay.hide': z.object({ kind }),
  /** Overlay UI → main: content size changed; main shrinks the overlay view to fit (so transparent areas never eat clicks). */
  'overlay.resize': z.object({ kind, width: z.number().min(1).max(2000), height: z.number().min(1).max(2000) }),
  /** Renderer finished mounting; main replies with initial state / pending overlay data. */
  'ui.ready': z.object({ kind: kind.optional() }).optional(),
  'find.run': z.object({ text: z.string().max(512), forward: z.boolean(), findNext: z.boolean() }),
  'find.stop': empty,
  'permission.respond': z.object({ requestId: id, allow: z.boolean(), remember: z.boolean() }),
  'cert.get': z.object({ tabId: id }),
  'settings.get': empty,
  'settings.update': settingsPatchSchema,
  'stats.get': empty,
  'theme.get': empty,
  'warning.proceedHttp': z.object({ url }),
  'shields.get': empty,
  'shields.setSite': z.object({ enabled: z.boolean() }),
  'shields.pick': empty,
  'shields.allowNavigation': z.object({ url }),
  'shields.rules.get': empty,
  'shields.rules.set': z.object({ text: z.string().max(200_000) }),
  'shields.lists': empty,
  'shields.refresh': empty,
  'vault.status': empty,
  'vault.create': z.object({ password: z.string().min(1).max(256) }),
  'vault.unlock': z.object({ password: z.string().min(1).max(256) }),
  'vault.lock': empty,
  'vault.destroy': z.object({ password: z.string().min(1).max(256) }),
  'bookmarks.list': empty,
  'bookmarks.add': z.object({ title: z.string().max(200), url: z.string().max(2048), folder: z.string().max(200).optional() }),
  'bookmarks.remove': z.object({ id: z.string().max(64) }),
  'bookmarks.import': empty,
  'passwords.list': empty,
  'passwords.save': z.object({ id: z.string().max(64).optional(), site: z.string().min(1).max(253), username: z.string().max(256), password: z.string().min(1).max(1024) }),
  'passwords.remove': z.object({ id: z.string().max(64) }),
  'passwords.reveal': z.object({ id: z.string().max(64) }),
  'tor.status': empty,
  'tor.retry': empty,
  'tor.newCircuit': empty,
  /** Internal pages ask main to navigate their own tab (new-tab search box, tiles, error page retry). */
  'page.navigate': z.object({ input: z.string().max(8192) })
} as const

export type CommandName = keyof typeof commandSchemas
export type CommandArgs<K extends CommandName> = z.input<(typeof commandSchemas)[K]>

export interface CommandResults {
  'cert.get': CertInfo | null
  'settings.get': Settings
  'settings.update': Settings
  'stats.get': PrivacyStats
  'theme.get': 'light' | 'dark' | 'tor'
  'tor.status': TorState
  'shields.get': ShieldsPanelInfo
  'shields.pick': { added: string | null }
  'shields.rules.get': string
  'shields.rules.set': { ok: boolean; lines: number; error?: string }
  'shields.lists': ShieldsListsInfo
  'vault.status': VaultStatus
  'vault.create': VaultResult
  'vault.unlock': VaultResult
  'vault.destroy': VaultResult
  'bookmarks.list': Bookmark[]
  'bookmarks.add': Bookmark
  'bookmarks.import': { added: number; error?: string }
  'passwords.list': PasswordEntry[]
  'passwords.save': PasswordEntry
  'passwords.reveal': string | null
  'tor.newCircuit': boolean
}
export type CommandResult<K extends CommandName> = K extends keyof CommandResults ? CommandResults[K] : void

export type Role = 'chrome' | 'overlay' | 'page'

const C: Role[] = ['chrome']
const CO: Role[] = ['chrome', 'overlay']
const P: Role[] = ['page']
/** Which webContents roles may call each command. */
export const commandRoles: Record<CommandName, readonly Role[]> = {
  'tab.new': CO,
  'tab.newContainer': CO,
  'tab.close': C,
  'tab.activate': CO,
  'tab.move': C,
  'tab.pin': C,
  'tab.mute': C,
  'tab.duplicate': C,
  'tab.closeOthers': C,
  'tab.closeRight': C,
  'tab.tearOff': C,
  'tab.contextMenu': C,
  'nav.go': CO,
  'nav.back': C,
  'nav.forward': C,
  'nav.reload': C,
  'nav.stop': C,
  'nav.home': C,
  'window.action': ['chrome', 'overlay', 'page'],
  'overlay.show': C,
  'overlay.hide': CO,
  'overlay.resize': ['overlay'],
  'ui.ready': CO,
  'find.run': ['overlay'],
  'find.stop': ['overlay'],
  'permission.respond': ['overlay'],
  'cert.get': ['overlay'],
  'settings.get': ['chrome', 'overlay', 'page'],
  'settings.update': ['chrome', 'page'],
  'stats.get': P,
  'theme.get': ['chrome', 'overlay', 'page'],
  'warning.proceedHttp': P,
  'shields.get': ['chrome', 'overlay'],
  'shields.setSite': ['overlay'],
  'shields.pick': ['overlay'],
  'shields.allowNavigation': ['overlay'],
  'shields.rules.get': P,
  'shields.rules.set': P,
  'shields.lists': P,
  'shields.refresh': P,
  'vault.status': ['chrome', 'page'],
  'vault.create': P,
  'vault.unlock': P,
  'vault.lock': P,
  'vault.destroy': P,
  'bookmarks.list': P,
  'bookmarks.add': P,
  'bookmarks.remove': P,
  'bookmarks.import': P,
  'passwords.list': P,
  'passwords.save': P,
  'passwords.remove': P,
  'passwords.reveal': P,
  'tor.status': ['chrome', 'page'],
  'tor.retry': P,
  'tor.newCircuit': C,
  'page.navigate': P
}

/** Main → renderer push messages. */
export type PushMessage =
  | { type: 'state'; state: WindowState }
  | { type: 'focus-omnibox'; select: boolean }
  | { type: 'overlay-data'; kind: OverlayKind; data: unknown; rect: Rect }
  | { type: 'overlay-closed'; kind: OverlayKind }
  | { type: 'find-result'; activeMatch: number; matches: number }
  | { type: 'settings'; settings: Settings }
  | { type: 'theme'; theme: 'light' | 'dark' | 'tor' }
  | { type: 'tor-status'; state: TorState }
