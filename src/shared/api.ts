import type { CommandArgs, CommandName, CommandResult, PushMessage } from './ipc'

/** The API exposed to trusted UI (chrome, overlays, internal pages) as `window.bmax`. */
export interface BmaxApi {
  platform: string
  cmd<K extends CommandName>(name: K, ...args: undefined extends CommandArgs<K> ? [args?: CommandArgs<K>] : [args: CommandArgs<K>]): Promise<CommandResult<K>>
  onPush(cb: (msg: PushMessage) => void): () => void
}
