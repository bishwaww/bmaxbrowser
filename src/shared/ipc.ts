import { z } from 'zod'
import { settingsPatchSchema } from './settings'
import type { Settings, PrivacyStats } from './settings'
import type { CertInfo, OverlayKind, Rect, WindowState } from './types'

export { IPC_CMD, IPC_PUSH } from './channels'

const id = z.number().int().nonnegative()
const url = z.string().max(8192)
const rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const kind = z.enum(['menu', 'cert', 'permission', 'find', 'suggest'])
const empty = z.object({}).strict().optional()

/** zod schema per command. Every IPC message is parsed against these in the main process. */
export const commandSchemas = {
  'tab.new': z.object({ url: url.optional(), background: z.boolean().optional() }).optional(),
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
      'zoomReset'
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
  'theme.get': 'light' | 'dark'
}
export type CommandResult<K extends CommandName> = K extends keyof CommandResults ? CommandResults[K] : void

export type Role = 'chrome' | 'overlay' | 'page'

const C: Role[] = ['chrome']
const CO: Role[] = ['chrome', 'overlay']
const P: Role[] = ['page']
/** Which webContents roles may call each command. */
export const commandRoles: Record<CommandName, readonly Role[]> = {
  'tab.new': CO,
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
  'window.action': CO,
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
  | { type: 'theme'; theme: 'light' | 'dark' }
