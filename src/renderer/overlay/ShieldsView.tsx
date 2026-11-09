import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShieldsPanelInfo } from '@shared/shields'

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative shrink-0 rounded-full disabled:opacity-40"
      style={{ width: 40, height: 22, background: on ? 'var(--accent)' : 'var(--active)', transition: 'background 120ms' }}
    >
      <span
        className="absolute rounded-full"
        style={{ top: 2, left: on ? 20 : 2, width: 18, height: 18, background: on ? 'var(--on-accent)' : 'var(--card)', transition: 'left 120ms', boxShadow: '0 1px 2px rgba(0,0,0,.4)' }}
      />
    </button>
  )
}

function Chip({ category }: { category: string }) {
  const color = category === 'tracker' ? '#b46bff' : category === 'custom' ? '#2bb673' : '#e8590c'
  return (
    <span className="shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase" style={{ background: `${color}33`, color }}>
      {category === 'ad' ? 'ad' : category}
    </span>
  )
}

export function ShieldsView() {
  const [info, setInfo] = useState<ShieldsPanelInfo | null>(null)
  const [showItems, setShowItems] = useState(false)
  const [note, setNote] = useState('')
  const timer = useRef<number | null>(null)

  const load = useCallback(() => void window.bmax.cmd('shields.get').then(setInfo), [])
  useEffect(() => {
    load()
    const off = window.bmax.onPush((m) => {
      if (m.type === 'state' || m.type === 'overlay-data') {
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(load, 120)
      }
    })
    return off
  }, [load])

  if (!info) return <div style={{ padding: 16 }}>Loading…</div>
  const off = !info.globalEnabled || !info.siteEnabled
  const engineMsg =
    info.engine.state === 'ready'
      ? ''
      : info.engine.state === 'error' || info.engine.state === 'offline'
        ? info.engine.message
        : `${info.engine.message || 'Preparing filter lists…'}`

  return (
    <div style={{ padding: 16, width: '100%', boxSizing: 'border-box' }} role="dialog" aria-label="Shields">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div style={{ fontSize: 14, fontWeight: 600 }}>Shields {off ? 'are off' : 'are up'}</div>
          <div className="truncate" style={{ color: 'var(--muted)', fontSize: 12 }}>
            {info.supported ? info.site : 'Not applicable to this page'}
          </div>
        </div>
        <Toggle
          on={info.supported && info.siteEnabled}
          disabled={!info.supported || !info.globalEnabled}
          label={`Shields for ${info.site}`}
          onChange={(v) => {
            void window.bmax.cmd('shields.setSite', { enabled: v }).then(() => window.setTimeout(load, 300))
          }}
        />
      </div>

      {!info.globalEnabled && (
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Shields are turned off for all sites in Settings.</p>
      )}

      <div className="mt-3 flex items-end gap-3">
        <div style={{ fontSize: 40, fontWeight: 300, lineHeight: 1 }} aria-label="Blocked on this page">
          {info.blocked}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12, paddingBottom: 4 }}>
          blocked on this page
          <div>
            {info.ads} ads &amp; annoyances · {info.trackers} trackers
            {info.customHidden > 0 && ` · ${info.customHidden} by your rules`}
          </div>
        </div>
      </div>

      {engineMsg && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>{engineMsg}</p>}

      {info.navigations.length > 0 && (
        <div className="mt-3 rounded-lg p-2" style={{ background: 'var(--field)' }}>
          {info.navigations.slice(0, 4).map((n, i) => (
            <div key={`${n.url}-${i}`} className="flex items-center gap-2" style={{ fontSize: 12, minHeight: 26 }}>
              <span className="shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase" style={{ background: 'var(--active)' }}>
                {n.kind === 'popup' ? 'pop-up' : 'redirect'}
              </span>
              <span className="min-w-0 flex-1 truncate" title={n.url}>
                {n.url}
              </span>
              {n.kind === 'redirect' && (
                <button
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                  style={{ border: '1px solid var(--border)' }}
                  onClick={() => void window.bmax.cmd('shields.allowNavigation', { url: n.url })}
                >
                  Allow
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {info.notificationsBlocked > 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Blocked {info.notificationsBlocked} notification request(s).</p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <button
          className="rounded-full px-4 py-2 text-left disabled:opacity-40"
          style={{ border: '1px solid var(--border)' }}
          disabled={!info.supported}
          onClick={async () => {
            const r = await window.bmax.cmd('shields.pick')
            setNote(r.added ? `Added rule ${r.added}` : '')
          }}
        >
          Block an element on this page…
        </button>
        <button
          className="rounded-full px-4 py-2 text-left"
          style={{ border: '1px solid var(--border)' }}
          onClick={() => {
            void window.bmax.cmd('tab.new', { url: 'bmax://settings/?section=Shields' })
            void window.bmax.cmd('overlay.hide', { kind: 'shields' })
          }}
        >
          Shields settings, lists &amp; custom rules
        </button>
      </div>
      {note && <p style={{ color: 'var(--ok)', fontSize: 12, marginTop: 6 }}>{note}</p>}

      {info.items.length > 0 && (
        <div className="mt-3">
          <button className="text-xs" style={{ color: 'var(--accent)' }} onClick={() => setShowItems(!showItems)}>
            {showItems ? 'Hide' : 'Show'} blocked items
          </button>
          {showItems && (
            <ul className="mt-2 overflow-y-auto" style={{ maxHeight: 150 }}>
              {info.items.map((it, i) => (
                <li key={`${it.host}-${i}`} className="flex items-center gap-2" style={{ fontSize: 12, minHeight: 22 }}>
                  <Chip category={it.category} />
                  <span className="min-w-0 flex-1 truncate">{it.host}</span>
                  <span style={{ color: 'var(--muted)' }}>{it.type}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--border)', color: 'var(--muted)', fontSize: 11 }}>
        Lifetime: {info.lifetime.adsBlocked.toLocaleString()} ads · {info.lifetime.trackersBlocked.toLocaleString()} trackers
      </div>
    </div>
  )
}
