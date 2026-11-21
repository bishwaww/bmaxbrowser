import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import type { Bookmark } from '@shared/vault'
import { useSiteIcons } from '../shared-ui/hooks'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Small round letter badge when the bookmark has no saved site icon. */
function Badge({ b, icon }: { b: Bookmark; icon: string | null | undefined }) {
  if (icon) return <img src={icon} alt="" width={16} height={16} className="shrink-0" style={{ borderRadius: 3 }} draggable={false} />
  const letter = (hostOf(b.url)[0] ?? '?').toUpperCase()
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: 16, height: 16, fontSize: 9, background: 'var(--active)', color: 'var(--fg)' }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

/** Chrome-style bookmarks bar: one click opens a bookmark, middle/Ctrl-click opens it in a new tab, right-click for more. */
export function BookmarksBar() {
  const [items, setItems] = useState<Bookmark[]>([])
  useEffect(() => {
    const load = () => void window.bmax.cmd('bookmarks.list').then(setItems)
    load()
    return window.bmax.onPush((m) => {
      if (m.type === 'bookmarks') load()
    })
  }, [])

  const icons = useSiteIcons(items.filter((b) => !b.icon).map((b) => b.url))

  const open = (e: MouseEvent, b: Bookmark) => {
    const newTab = e.button === 1 || e.ctrlKey || e.metaKey
    void window.bmax.cmd('nav.go', { input: b.url, newTab })
  }

  return (
    <div
      role="toolbar"
      aria-label="Bookmarks bar"
      className="flex items-center gap-0.5 overflow-hidden"
      style={{ height: 32, padding: '0 8px', background: 'var(--bar)', borderBottom: '1px solid var(--border)', fontSize: 12 }}
    >
      {items.length === 0 && (
        <span className="truncate px-2" style={{ color: 'var(--muted)' }}>
          Bookmarks you add with the ☆ star (Ctrl+D) appear here.
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden" style={{ height: 28, flexWrap: 'wrap' }}>
        {items.map((b) => (
          <button
            key={b.id}
            data-bookmark={b.url}
            title={`${b.title}\n${b.url}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-2 hover:bg-[var(--hover)]"
            style={{ height: 26, maxWidth: 168 }}
            onClick={(e) => open(e, b)}
            onAuxClick={(e) => {
              if (e.button === 1) open(e, b)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              void window.bmax.cmd('bookmarks.contextMenu', { id: b.id })
            }}
          >
            <Badge b={b} icon={b.icon ?? icons[b.url]} />
            <span className="truncate">{b.title || hostOf(b.url)}</span>
          </button>
        ))}
      </div>
      <button
        className="shrink-0 rounded-full px-2 hover:bg-[var(--hover)]"
        style={{ height: 26, color: 'var(--muted)' }}
        title="All bookmarks (Ctrl+Shift+O)"
        aria-label="All bookmarks"
        onClick={() => void window.bmax.cmd('window.action', { name: 'bookmarks' })}
      >
        All bookmarks
      </button>
    </div>
  )
}
