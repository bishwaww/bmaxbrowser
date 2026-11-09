import './overlay.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OverlayKind, Rect } from '@shared/types'
import { CertView } from './CertView'
import { FindView } from './FindView'
import { MenuView } from './MenuView'
import { PermissionView } from './PermissionView'
import { SuggestView } from './SuggestView'

const KINDS: OverlayKind[] = ['menu', 'cert', 'permission', 'find', 'suggest']

function kindFromUrl(): OverlayKind {
  const k = new URLSearchParams(location.search).get('kind') as OverlayKind | null
  return k && KINDS.includes(k) ? k : 'menu'
}

export function App() {
  const kind = kindFromUrl()
  const [payload, setPayload] = useState<{ data: unknown; rect: Rect; seq: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = window.bmax.onPush((m) => {
      if (m.type === 'overlay-data' && m.kind === kind) setPayload((p) => ({ data: m.data, rect: m.rect, seq: (p?.seq ?? 0) + 1 }))
    })
    void window.bmax.cmd('ui.ready', { kind })
    return off
  }, [kind])

  // Shrink the overlay view to its content so transparent areas never swallow clicks meant for the page.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let last = ''
    const report = (): void => {
      const w = Math.ceil(el.offsetWidth)
      const h = Math.ceil(el.offsetHeight)
      const key = `${w}x${h}`
      if (key === last || w < 2 || h < 2) return
      last = key
      void window.bmax.cmd('overlay.resize', { kind, width: w, height: h })
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [kind, payload])

  if (!payload) return null
  const width = payload.rect.width
  return (
    <div ref={wrapRef} style={{ width, padding: '4px 8px 12px', boxSizing: 'border-box', background: 'transparent' }}>
      <div style={{ background: 'var(--card)', borderRadius: 10, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        {kind === 'menu' && <MenuView />}
        {kind === 'cert' && <CertView data={payload.data as { tabId: number; url: string; security: string }} />}
        {kind === 'permission' && <PermissionView data={payload.data as never} />}
        {kind === 'find' && <FindView data={payload.data as { text: string }} seq={payload.seq} />}
        {kind === 'suggest' && <SuggestView data={payload.data as never} />}
      </div>
    </div>
  )
}
