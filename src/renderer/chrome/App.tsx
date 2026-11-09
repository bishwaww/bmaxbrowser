import { useCallback, useEffect, useRef } from 'react'
import type { OverlayKind, Rect } from '@shared/types'
import { useSettings, useWindowState } from '../shared-ui/hooks'
import { TabStrip } from './TabStrip'
import { Toolbar } from './Toolbar'

export function App() {
  const state = useWindowState()
  const settings = useSettings()
  const lastClosed = useRef<Partial<Record<OverlayKind, number>>>({})
  const openKinds = useRef(new Set<OverlayKind>())

  useEffect(
    () =>
      window.bmax.onPush((m) => {
        if (m.type === 'overlay-closed') {
          lastClosed.current[m.kind] = Date.now()
          openKinds.current.delete(m.kind)
        }
      }),
    []
  )

  useEffect(() => {
    if (state) document.documentElement.dataset.theme = state.theme
  }, [state?.theme, state])

  // An overlay closes itself when it loses focus, which happens *before* the click that would toggle it.
  // Ignore a re-open request that arrives right after that close so the button behaves like a toggle.
  const toggleOverlay = useCallback((kind: OverlayKind, rect: Rect, data?: unknown) => {
    const closedRecently = Date.now() - (lastClosed.current[kind] ?? 0) < 250
    if (closedRecently) return
    openKinds.current.add(kind)
    void window.bmax.cmd('overlay.show', { kind, rect, data })
  }, [])

  if (!state) return <div style={{ height: 84, background: 'var(--strip)' }} />
  return (
    <div className="flex flex-col" style={{ height: 84, background: 'var(--strip)' }}>
      <TabStrip state={state} />
      <Toolbar state={state} settings={settings} toggleOverlay={toggleOverlay} />
    </div>
  )
}
