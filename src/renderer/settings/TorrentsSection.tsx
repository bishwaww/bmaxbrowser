import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Settings, SettingsPatch } from '@shared/settings'
import type { TorrentsStatus } from '@shared/torrents'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="rounded-xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        {children}
      </div>
    </section>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-6 py-1.5">
      <span>
        {label}
        {hint && (
          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
            {hint}
          </span>
        )}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

const box = { background: 'var(--field)', border: '1px solid var(--border)' }

function NumberField({ label, value, unit, min, max, onCommit, hint }: { label: string; value: number; unit: string; min: number; max: number; onCommit: (n: number) => void; hint?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Math.round(Number(text))
    if (Number.isFinite(n) && n >= min && n <= max) onCommit(n)
    else setText(String(value))
  }
  return (
    <label className="flex items-center justify-between gap-6 py-1.5">
      <span>
        {label}
        {hint && (
          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
            {hint}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <input
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="w-24 rounded-md px-2 py-1 text-right"
          style={box}
        />
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {unit}
        </span>
      </span>
    </label>
  )
}

export function TorrentsSection({ settings, update }: { settings: Settings; update: (p: SettingsPatch) => void }) {
  const t = settings.torrents
  const set = (patch: Partial<Settings['torrents']>): void => update({ torrents: { ...t, ...patch } })
  const [status, setStatus] = useState<TorrentsStatus | null>(null)
  useEffect(() => {
    void window.bmax.cmd('torrents.list').then((r) => setStatus(r.status)).catch(() => undefined)
  }, [])

  return (
    <>
      <div role="alert" className="mb-6 rounded-xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--danger)' }}>
        <div className="mb-1 font-semibold" style={{ color: 'var(--danger)' }}>
          Torrent traffic is NOT routed through Tor and exposes your IP address
        </div>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Peers and trackers see your real IP address. BMAX never sends torrent traffic through Tor, ignores the proxy set under Network, and disables torrents completely in Tor windows.
        </p>
      </div>

      <Group title="Where files are saved">
        <div className="flex items-center justify-between gap-3">
          <code className="min-w-0 flex-1 truncate" title={t.folder} style={{ userSelect: 'text' }}>
            {t.folder || 'Downloads folder / Torrents'}
          </code>
          <button
            className="shrink-0 rounded-full px-4 py-2"
            style={{ border: '1px solid var(--border)' }}
            onClick={async () => {
              const p = await window.bmax.cmd('torrents.chooseFolder')
              if (p) set({ folder: p })
            }}
          >
            Change…
          </button>
          {t.folder && (
            <button className="shrink-0 rounded-full px-3 py-2 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => set({ folder: '' })}>
              Reset
            </button>
          )}
        </div>
      </Group>

      <Group title="Speed and connections">
        <NumberField label="Download speed limit" unit="KiB/s" min={0} max={10_000_000} value={t.downKBps} onCommit={(downKBps) => set({ downKBps })} hint="0 = unlimited" />
        <NumberField label="Upload speed limit" unit="KiB/s" min={0} max={10_000_000} value={t.upKBps} onCommit={(upKBps) => set({ upKBps })} hint="0 = unlimited" />
        <NumberField label="Maximum connections" unit="peers" min={5} max={1000} value={t.maxConnections} onCommit={(maxConnections) => set({ maxConnections })} />
      </Group>

      <Group title="Behaviour">
        <Toggle checked={t.stopSeedingWhenDone} onChange={(stopSeedingWhenDone) => set({ stopSeedingWhenDone })} label="Stop seeding when a download finishes" hint="Otherwise BMAX keeps sharing until you remove the torrent or close the browser." />
        <Toggle checked={t.askFiles} onChange={(askFiles) => set({ askFiles })} label="Let me choose which files to download" hint="Show the file list first and wait for your choice." />
      </Group>

      <Group title="Network options">
        <Toggle checked={t.dht} onChange={(dht) => set({ dht })} label="Find peers through the DHT" hint="Needed for magnet links without trackers. Takes effect once no torrents are active." />
        <Toggle checked={t.lsd} onChange={(lsd) => set({ lsd })} label="Find peers on the local network" hint="Announces your torrents to other devices on your LAN. Off by default." />
        <Toggle checked={t.upnp} onChange={(upnp) => set({ upnp })} label="Ask my router to open a port (UPnP / NAT-PMP)" hint="Improves incoming connections but changes your router's configuration. Off by default." />
      </Group>

      <Group title="Magnet links">
        <Toggle
          checked={status?.isDefaultHandler ?? false}
          onChange={async (enabled) => {
            const r = await window.bmax.cmd('torrents.setDefaultHandler', { enabled })
            setStatus((s) => (s ? { ...s, isDefaultHandler: r } : s))
          }}
          label="Open magnet links from other applications in BMAX"
          hint="Registers BMAX as the handler for magnet: links for your Windows user. Magnet links clicked inside BMAX always open the torrent manager."
        />
      </Group>
    </>
  )
}
