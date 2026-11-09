import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CMD, IPC_PUSH } from '../shared/channels'
import type { PushMessage } from '../shared/ipc'

/** Expose the typed command API. Main re-validates sender role + payload on every call. */
export function exposeBmaxApi(): void {
  contextBridge.exposeInMainWorld('bmax', {
    platform: process.platform,
    cmd: (name: string, args?: unknown): Promise<unknown> => ipcRenderer.invoke(IPC_CMD, name, args),
    onPush: (cb: (msg: PushMessage) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, msg: PushMessage): void => cb(msg)
      ipcRenderer.on(IPC_PUSH, listener)
      return () => ipcRenderer.removeListener(IPC_PUSH, listener)
    }
  })
}
