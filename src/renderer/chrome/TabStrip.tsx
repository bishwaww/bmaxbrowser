import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TabInfo, WindowState } from '@shared/types'
import { IconClose, IconGlobe, IconMuted, IconPlus, IconShield, IconSpeaker } from '../shared-ui/icons'

const PINNED_W = 38
const MAX_W = 240
const MIN_W = 40
const NEWTAB_BTN_W = 36
const TEAR_DY = 46

interface DragState {
  id: number
  left: number
  index: number
  tearing: boolean
}

function layoutTabs(tabs: TabInfo[], avail: number): { x: number; w: number }[] {
  const pinned = tabs.filter((t) => t.pinned).length
  const normal = tabs.length - pinned
  const room = avail - pinned * PINNED_W
  const w = normal > 0 ? Math.max(MIN_W, Math.min(MAX_W, room / normal)) : MAX_W
  let x = 0
  return tabs.map((t) => {
    const tw = t.pinned ? PINNED_W : w
    const pos = { x, w: tw }
    x += tw
    return pos
  })
}

function containerHue(label: string): number {
  let h = 0
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

function TabIcon({ tab }: { tab: TabInfo }) {
  if (tab.loading) {
    return (
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
    )
  }
  if (tab.favicon) return <img src={tab.favicon} alt="" width={16} height={16} className="shrink-0" draggable={false} />
  return (
    <span className="shrink-0" style={{ color: 'var(--muted)' }}>
      {tab.isNewTab || tab.url.startsWith('bmax://') ? <IconShield size={16} /> : <IconGlobe size={16} />}
    </span>
  )
}

export function TabStrip({ state }: { state: WindowState }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [optimistic, setOptimistic] = useState<number[] | null>(null)
  const session = useRef<{
    id: number
    startX: number
    startY: number
    startLeft: number
    origIndex: number
    pointerId: number
    active: boolean
    layout: { x: number; w: number }[]
    ids: number[]
  } | null>(null)

  const mac = state.platform === 'darwin'
  const leftPad = mac ? 80 : 8
  const rightPad = mac ? 8 : 146 // room for the native window-control overlay

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Server state caught up → drop the optimistic order.
  useEffect(() => setOptimistic(null), [state.tabs])

  const tabs = useMemo(() => {
    if (!optimistic) return state.tabs
    const byId = new Map(state.tabs.map((t) => [t.id, t]))
    const ordered = optimistic.map((id) => byId.get(id)).filter((t): t is TabInfo => !!t)
    return ordered.length === state.tabs.length ? ordered : state.tabs
  }, [state.tabs, optimistic])

  const avail = Math.max(0, width - leftPad - rightPad - NEWTAB_BTN_W)
  const base = layoutTabs(tabs, avail)

  // While dragging, render the order the tab would take if dropped now.
  let renderTabs = tabs
  let positions = base
  if (drag) {
    const dragged = tabs.find((t) => t.id === drag.id)
    if (dragged) {
      const others = tabs.filter((t) => t.id !== drag.id)
      const order = [...others]
      order.splice(drag.index, 0, dragged)
      renderTabs = order
      positions = layoutTabs(order, avail)
    }
  }

  const onPointerDown = (e: React.PointerEvent, tab: TabInfo, index: number) => {
    if (e.button === 1) {
      void window.bmax.cmd('tab.close', { id: tab.id })
      return
    }
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-tab-btn]')) return
    if (tab.id !== state.activeTabId) void window.bmax.cmd('tab.activate', { id: tab.id })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    session.current = {
      id: tab.id,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: base[index]?.x ?? 0,
      origIndex: index,
      pointerId: e.pointerId,
      active: false,
      layout: base,
      ids: tabs.map((t) => t.id)
    }
  }

  const onPointerMove = (e: React.PointerEvent, tab: TabInfo) => {
    const s = session.current
    if (!s || s.id !== tab.id) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.active && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    s.active = true
    const w = s.layout[s.origIndex]?.w ?? MAX_W
    const left = Math.max(0, Math.min(s.startLeft + dx, avail - w))
    const center = left + w / 2
    // Index among the *other* tabs, limited to the dragged tab's own group (pinned / unpinned).
    const others = tabs.filter((t) => t.id !== tab.id)
    const pinnedOthers = others.filter((t) => t.pinned).length
    let idx = 0
    let x = 0
    for (const o of others) {
      const ow = o.pinned ? PINNED_W : (s.layout.find((_, i) => tabs[i]?.id === o.id)?.w ?? w)
      if (center > x + ow / 2) idx++
      x += ow
    }
    idx = tab.pinned ? Math.min(idx, pinnedOthers) : Math.max(idx, pinnedOthers)
    setDrag({ id: tab.id, left, index: idx, tearing: Math.abs(dy) > TEAR_DY })
  }

  const onPointerUp = (e: React.PointerEvent, tab: TabInfo) => {
    const s = session.current
    session.current = null
    if (!s || s.id !== tab.id) return
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(s.pointerId)
    const d = drag
    setDrag(null)
    if (!s.active || !d) return
    if (d.tearing) {
      void window.bmax.cmd('tab.tearOff', { id: tab.id, screenX: e.screenX, screenY: e.screenY })
    } else if (d.index !== s.origIndex) {
      const others = s.ids.filter((id) => id !== tab.id)
      others.splice(d.index, 0, tab.id)
      setOptimistic(others)
      void window.bmax.cmd('tab.move', { id: tab.id, index: d.index })
    }
  }

  const lastEnd = positions.length ? (positions[positions.length - 1]!.x + positions[positions.length - 1]!.w) : 0

  return (
    <div
      ref={ref}
      className="drag relative"
      style={{ height: 40, background: 'var(--strip)', overflow: 'hidden' }}
      onDoubleClick={() => undefined}
    >
      <div className="absolute" style={{ left: leftPad, top: 0, bottom: 0, right: rightPad }}>
        {renderTabs.map((tab, i) => {
          const pos = positions[i]!
          const active = tab.id === state.activeTabId
          const dragging = drag?.id === tab.id
          const showClose = !tab.pinned && pos.w > 78
          const showAudio = tab.audible || tab.muted
          const left = dragging ? drag.left : pos.x
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              data-sleeping={tab.sleeping}
              title={tab.sleeping ? `${tab.title} (sleeping: reloads when selected)` : tab.title}
              className="no-drag group absolute flex items-center"
              style={{
                left,
                width: pos.w,
                top: 6,
                height: 34,
                padding: '0 2px',
                zIndex: dragging ? 5 : active ? 3 : 1,
                transition: dragging ? 'none' : 'left 140ms ease, width 140ms ease',
                opacity: dragging && drag.tearing ? 0.6 : 1
              }}
              onPointerDown={(e) => onPointerDown(e, tab, i)}
              onPointerMove={(e) => onPointerMove(e, tab)}
              onPointerUp={(e) => onPointerUp(e, tab)}
              onContextMenu={(e) => {
                e.preventDefault()
                void window.bmax.cmd('tab.contextMenu', { id: tab.id })
              }}
            >
              <div
                className="flex h-full w-full items-center gap-2 overflow-hidden"
                style={{
                  borderRadius: '8px 8px 0 0',
                  padding: tab.pinned ? '0 10px' : '0 8px 0 10px',
                  background: active ? 'var(--bar)' : 'transparent',
                  boxShadow: active ? '0 -1px 0 0 var(--border) inset' : undefined
                }}
              >
                <TabIcon tab={tab} />
                {tab.container && !tab.pinned && (
                  <span
                    title="Container tab: isolated from other tabs"
                    className="shrink-0"
                    style={{ width: 7, height: 7, borderRadius: 4, background: `hsl(${containerHue(tab.container)} 75% 55%)` }}
                  />
                )}
                {!tab.pinned && (
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ fontSize: 12, color: active ? 'var(--fg)' : 'var(--muted)', opacity: tab.sleeping ? 0.55 : 1, fontStyle: tab.sleeping ? 'italic' : undefined }}
                  >
                    {tab.title}
                  </span>
                )}
                {!tab.pinned && showAudio && (
                  <button
                    data-tab-btn
                    className="icon-btn shrink-0"
                    style={{ width: 20, height: 20 }}
                    title={tab.muted ? 'Unmute tab' : 'Mute tab'}
                    onClick={() => void window.bmax.cmd('tab.mute', { id: tab.id, muted: !tab.muted })}
                  >
                    {tab.muted ? <IconMuted size={13} /> : <IconSpeaker size={13} />}
                  </button>
                )}
                {showClose && (
                  <button
                    data-tab-btn
                    className="icon-btn shrink-0"
                    style={{ width: 20, height: 20 }}
                    title="Close tab"
                    onClick={() => void window.bmax.cmd('tab.close', { id: tab.id })}
                  >
                    <IconClose size={12} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
        <button
          className="icon-btn no-drag absolute"
          style={{ left: lastEnd + 4, top: 8, width: 28, height: 28, transition: drag ? 'none' : 'left 140ms ease' }}
          title="New tab (Ctrl+T)"
          onClick={() => void window.bmax.cmd('tab.new')}
        >
          <IconPlus size={16} />
        </button>
      </div>
    </div>
  )
}
