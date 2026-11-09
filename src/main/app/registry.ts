import type { WebContents } from 'electron'
import type { OverlayKind } from '@shared/types'
import type { BmaxWindow } from '../windows/BmaxWindow'
import type { Tab } from '../tabs/Tab'

export type WcInfo =
  | { role: 'chrome'; window: BmaxWindow }
  | { role: 'overlay'; window: BmaxWindow; kind: OverlayKind }
  | { role: 'tab'; tab: Tab }

const map = new Map<number, WcInfo>()

export const registry = {
  register(wc: WebContents, info: WcInfo): void {
    const id = wc.id
    map.set(id, info)
    wc.once('destroyed', () => map.delete(id))
  },
  get(id: number): WcInfo | undefined {
    return map.get(id)
  },
  unregister(id: number): void {
    map.delete(id)
  }
}
