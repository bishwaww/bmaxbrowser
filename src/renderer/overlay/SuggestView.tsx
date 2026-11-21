import { useState } from 'react'
import type { SuggestionItem } from '@shared/types'
import { IconGlobe, IconSearch } from '../shared-ui/icons'

/** Omnibox dropdown. Keyboard focus stays in the address bar; picks happen on mousedown (before focus moves). */
export function SuggestView({ data }: { data: { items: SuggestionItem[]; selected: number } }) {
  const [hover, setHover] = useState<number | null>(null)
  const pick = (item: SuggestionItem) => {
    if (item.kind === 'tab' && item.tabId !== undefined) void window.bmax.cmd('tab.activate', { id: item.tabId })
    else void window.bmax.cmd('nav.go', { input: item.url })
    void window.bmax.cmd('overlay.hide', { kind: 'suggest' })
  }
  return (
    <div style={{ padding: '6px 0' }} role="listbox">
      {data.items.map((item, i) => {
        const active = hover !== null ? hover === i : data.selected === i
        return (
          <div
            key={`${item.kind}-${item.url}-${i}`}
            role="option"
            aria-selected={active}
            className="flex items-center gap-3 px-4"
            style={{ height: 40, background: active ? 'var(--hover)' : undefined }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onMouseDown={(e) => {
              e.preventDefault()
              pick(item)
            }}
          >
            <span className="grid shrink-0 place-items-center" style={{ color: 'var(--muted)', width: 16, height: 16 }}>
              {item.icon ? <img src={item.icon} alt="" width={16} height={16} /> : item.kind === 'search' ? <IconSearch size={16} /> : <IconGlobe size={16} />}
            </span>
            <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13 }}>
              {item.text}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>
              {item.kind === 'search' ? 'Search' : item.kind === 'tab' ? 'Switch to tab' : 'Open'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
