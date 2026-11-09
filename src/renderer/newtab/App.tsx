import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getSearchEngine } from '@shared/search-engines'
import type { PrivacyStats, Tile } from '@shared/settings'
import { useSettings } from '../shared-ui/hooks'
import { IconPlus, IconSearch } from '../shared-ui/icons'

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function hue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

function formatTime(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function TileEditor({ tile, onSave, onCancel }: { tile: Tile | null; onSave: (t: Tile) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(tile?.title ?? '')
  const [url, setUrl] = useState(tile?.url ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = url.trim()
    if (!clean) return
    const full = /^[a-z][a-z0-9+.-]*:/i.test(clean) ? clean : `https://${clean}`
    if (!/^https?:\/\//i.test(full)) return
    let name = title.trim()
    if (!name) {
      try {
        name = new URL(full).hostname.replace(/^www\./, '')
      } catch {
        name = full
      }
    }
    onSave({ id: tile?.id ?? crypto.randomUUID(), title: name.slice(0, 80), url: full })
  }
  return (
    <div className="fixed inset-0 z-10 grid place-items-center" style={{ background: 'rgba(0,0,0,0.4)' }} onMouseDown={onCancel}>
      <form
        className="w-80 rounded-xl p-5"
        style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="mb-3 text-base font-semibold">{tile ? 'Edit shortcut' : 'Add shortcut'}</h2>
        <label className="mb-1 block text-xs" style={{ color: 'var(--muted)' }}>
          Name
        </label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          className="mb-3 w-full rounded-md px-3 py-2"
          style={{ background: 'var(--field)', border: '1px solid var(--border)', userSelect: 'text' }}
        />
        <label className="mb-1 block text-xs" style={{ color: 'var(--muted)' }}>
          URL
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="mb-4 w-full rounded-md px-3 py-2"
          style={{ background: 'var(--field)', border: '1px solid var(--border)', userSelect: 'text' }}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-full px-4 py-1.5" style={{ border: '1px solid var(--border)' }} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="rounded-full px-4 py-1.5" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

export function App() {
  const settings = useSettings()
  const now = useClock()
  const [query, setQuery] = useState('')
  const [stats, setStats] = useState<PrivacyStats | null>(null)
  const [editing, setEditing] = useState<{ tile: Tile | null } | null>(null)

  useEffect(() => {
    void window.bmax.cmd('stats.get').then(setStats)
  }, [])

  if (!settings) return null
  const engine = getSearchEngine(settings.searchEngine)
  const saveTiles = (tiles: Tile[]) => void window.bmax.cmd('settings.update', { tiles })

  const search = (e: FormEvent) => {
    e.preventDefault()
    if (query.trim()) void window.bmax.cmd('page.navigate', { input: query })
  }

  return (
    <main className="flex min-h-full flex-col items-center px-6" style={{ paddingTop: '9vh', background: 'var(--bar)' }}>
      <div className="text-center">
        <div style={{ fontSize: 72, fontWeight: 300, letterSpacing: -2, lineHeight: 1 }}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div style={{ color: 'var(--muted)', marginTop: 8, fontSize: 15 }}>
          {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <form onSubmit={search} className="mt-8 flex w-full items-center gap-3 rounded-full px-5" style={{ maxWidth: 560, height: 48, background: 'var(--field)', border: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--muted)' }}>
          <IconSearch size={18} />
        </span>
        <input
          autoFocus
          aria-label={`Search with ${engine.name}`}
          placeholder={`Search with ${engine.name}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none"
          style={{ fontSize: 15, userSelect: 'text' }}
        />
      </form>

      <section className="mt-10 grid w-full gap-4" style={{ maxWidth: 640, gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }} aria-label="Shortcuts">
        {settings.tiles.map((tile) => (
          <div key={tile.id} className="group relative">
            <button
              className="flex w-full flex-col items-center gap-2 rounded-xl p-3 hover:bg-[var(--hover)]"
              onClick={() => void window.bmax.cmd('page.navigate', { input: tile.url })}
              title={tile.url}
            >
              <span
                className="grid place-items-center rounded-full text-lg font-semibold text-white"
                style={{ width: 48, height: 48, background: `hsl(${hue(tile.title)} 55% 45%)` }}
              >
                {tile.title.charAt(0).toUpperCase()}
              </span>
              <span className="w-full truncate text-center text-xs">{tile.title}</span>
            </button>
            <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
              <button
                className="icon-btn"
                style={{ width: 22, height: 22, background: 'var(--card)', fontSize: 11 }}
                title="Edit"
                onClick={() => setEditing({ tile })}
              >
                ✎
              </button>
              <button
                className="icon-btn"
                style={{ width: 22, height: 22, background: 'var(--card)', fontSize: 11 }}
                title="Remove"
                onClick={() => saveTiles(settings.tiles.filter((t) => t.id !== tile.id))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {settings.tiles.length < 24 && (
          <button className="flex flex-col items-center gap-2 rounded-xl p-3 hover:bg-[var(--hover)]" onClick={() => setEditing({ tile: null })}>
            <span className="grid place-items-center rounded-full" style={{ width: 48, height: 48, background: 'var(--field)', color: 'var(--muted)' }}>
              <IconPlus size={22} />
            </span>
            <span className="text-xs">Add shortcut</span>
          </button>
        )}
      </section>

      <section className="mt-12 flex gap-4" aria-label="Privacy statistics">
        {[
          ['Ads blocked', stats ? stats.adsBlocked.toLocaleString() : '–'],
          ['Trackers blocked', stats ? stats.trackersBlocked.toLocaleString() : '–'],
          ['Time saved (est.)', stats ? formatTime(stats.timeSavedMs) : '–']
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl px-5 py-3 text-center" style={{ background: 'var(--field)', minWidth: 130 }}>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {label}
            </div>
          </div>
        ))}
      </section>
      <p className="mb-6 mt-3 text-xs" style={{ color: 'var(--muted)' }}>
        Lifetime totals, stored on this device as three numbers.
      </p>

      {editing && (
        <TileEditor
          tile={editing.tile}
          onCancel={() => setEditing(null)}
          onSave={(t) => {
            const exists = settings.tiles.some((x) => x.id === t.id)
            saveTiles(exists ? settings.tiles.map((x) => (x.id === t.id ? t : x)) : [...settings.tiles, t])
            setEditing(null)
          }}
        />
      )}
    </main>
  )
}
