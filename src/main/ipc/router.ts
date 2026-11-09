import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { commandRoles, commandSchemas, IPC_CMD } from '@shared/ipc'
import type { CommandName, CommandResult, Role } from '@shared/ipc'
import type { OverlayKind } from '@shared/types'
import { internalPageOf } from '../app/internal-pages'
import { registry } from '../app/registry'
import type { Tab } from '../tabs/Tab'
import type { BmaxWindow } from '../windows/BmaxWindow'

export interface CommandContext {
  role: Role
  window: BmaxWindow
  /** Set for 'page' role (the tab hosting the internal page). */
  tab?: Tab
  overlayKind?: OverlayKind
}

type Handler<K extends CommandName> = (
  args: z.output<(typeof commandSchemas)[K]>,
  ctx: CommandContext
) => CommandResult<K> | Promise<CommandResult<K>>
export type Handlers = { [K in CommandName]: Handler<K> }

/** Work out who is calling. Roles come from the main-process registry + the frame's actual URL, never from the renderer. */
function resolveSender(event: IpcMainInvokeEvent): CommandContext | null {
  const wc = event.sender
  const info = registry.get(wc.id)
  const frame = event.senderFrame
  if (!info || !frame || frame !== wc.mainFrame) return null
  const page = internalPageOf(frame.url)
  switch (info.role) {
    case 'chrome':
      return page === 'chrome' ? { role: 'chrome', window: info.window } : null
    case 'overlay':
      return page === 'overlay' ? { role: 'overlay', window: info.window, overlayKind: info.kind } : null
    case 'tab':
      // Only the main frame of a tab currently showing an internal page is trusted.
      return page && page !== 'chrome' && page !== 'overlay'
        ? { role: 'page', window: info.tab.window, tab: info.tab }
        : null
  }
}

export function registerIpc(handlers: Handlers): void {
  ipcMain.handle(IPC_CMD, async (event, name: unknown, args: unknown) => {
    if (typeof name !== 'string' || !Object.hasOwn(commandSchemas, name)) throw new Error('Unknown command')
    const cmd = name as CommandName
    const ctx = resolveSender(event)
    if (!ctx || !commandRoles[cmd].includes(ctx.role)) throw new Error(`Forbidden: ${cmd}`)
    const parsed = (commandSchemas[cmd] as z.ZodType).safeParse(args)
    if (!parsed.success) throw new Error(`Invalid arguments for ${cmd}`)
    const handler = handlers[cmd] as (a: unknown, c: CommandContext) => unknown
    return handler(parsed.data, ctx)
  })
}
