import { useEffect, useState } from 'react'
import type { TorState } from '@shared/types'

export function App() {
  const [state, setState] = useState<TorState | null>(null)
  useEffect(() => {
    void window.bmax.cmd('tor.status').then(setState)
    return window.bmax.onPush((m) => m.type === 'tor-status' && setState(m.state))
  }, [])
  const s = state ?? { status: 'starting', progress: 0, summary: 'Starting Tor…' }
  const failed = s.status === 'failed' || s.status === 'missing'
  return (
    <main className="mx-auto flex h-full max-w-xl flex-col justify-center px-8" style={{ userSelect: 'text' }}>
      <h1 className="mb-1 text-2xl font-semibold">Tor Browsing</h1>
      <p className="mb-6" style={{ color: 'var(--muted)' }}>
        This window sends all traffic through the Tor network. No page loads until Tor is connected.
      </p>

      {!failed && (
        <>
          <div
            role="progressbar"
            aria-valuenow={s.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mb-2 overflow-hidden rounded-full"
            style={{ height: 10, background: 'var(--field)' }}
          >
            <div style={{ width: `${s.progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 300ms ease' }} />
          </div>
          <p className="text-sm">
            {s.progress}% — {s.summary}
          </p>
        </>
      )}

      {failed && (
        <div className="rounded-xl p-4" style={{ background: 'var(--field)', border: '1px solid var(--border)' }}>
          <p className="mb-2 font-semibold">{s.summary}</p>
          {s.error && <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>{s.error}</p>}
          <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>
            Nothing was loaded and nothing left your computer.
          </p>
          <button
            className="rounded-full px-5 py-2"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            onClick={() => void window.bmax.cmd('tor.retry')}
          >
            Try again
          </button>
        </div>
      )}

      <p className="mt-8 text-xs" style={{ color: 'var(--muted)' }}>
        Tor hides your IP address from the sites you visit. It does not make this browser look identical to every other Tor Browser user,
        so for the strongest anonymity use the official Tor Browser.
      </p>
    </main>
  )
}
