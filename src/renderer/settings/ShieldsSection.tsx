import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ShieldsListsInfo } from '@shared/shields'
import type { Settings, SettingsPatch } from '@shared/settings'

const inputStyle = { background: 'var(--field)', border: '1px solid var(--border)', userSelect: 'text' as const }

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

function ago(ms: number): string {
  if (!ms) return 'not downloaded'
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 90) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

function RulesEditor() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    void window.bmax.cmd('shields.rules.get').then((t) => {
      setText(t)
      setSaved(t)
    })
  }, [])
  return (
    <Group title="Custom filters">
      <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
        One rule per line, in the usual ad-blocker syntax: <code>||ads.example.com^</code> blocks a domain, <code>example.com##.banner</code> hides an element,{' '}
        <code>@@||example.com^</code> allows something. Lines starting with <code>!</code> are comments. Elements you hide with the picker are added here.
      </p>
      <textarea
        aria-label="Custom filter rules"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-48 w-full rounded-md p-3 font-mono text-xs"
        style={inputStyle}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          className="rounded-full px-4 py-2"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          disabled={text === saved}
          onClick={async () => {
            const r = await window.bmax.cmd('shields.rules.set', { text })
            if (r.ok) {
              setSaved(text)
              setMsg(`Saved ${r.lines} rule${r.lines === 1 ? '' : 's'}. Reload pages to apply.`)
            } else setMsg(r.error ?? 'Could not save.')
          }}
        >
          Save rules
        </button>
        {msg && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {msg}
          </span>
        )}
      </div>
    </Group>
  )
}

export function ShieldsSection({ settings, update }: { settings: Settings; update: (p: SettingsPatch) => void }) {
  const s = settings.shields
  const [info, setInfo] = useState<ShieldsListsInfo | null>(null)
  const load = useCallback(() => void window.bmax.cmd('shields.lists').then(setInfo), [])
  useEffect(() => {
    load()
    const t = window.setInterval(load, 1500)
    return () => window.clearInterval(t)
  }, [load])
  const set = (patch: Partial<Settings['shields']>) => update({ shields: { ...s, ...patch } })
  const setList = (id: string, on: boolean) => set({ lists: { ...s.lists, [id]: on } })

  const main = info?.lists.filter((l) => l.category !== 'regional') ?? []
  const regional = info?.lists.filter((l) => l.category === 'regional') ?? []
  const engine = info?.engine

  return (
    <>
      <Group title="Shields">
        <Toggle checked={s.enabled} onChange={(enabled) => set({ enabled })} label="Block ads, trackers and annoyances" hint="Master switch for every site. You can also turn Shields off for one site from the toolbar." />
        <Toggle checked={s.blockPopups} onChange={(blockPopups) => set({ blockPopups })} label="Block pop-ups and pop-unders" hint="Pages can open a new window only right after you click or type." />
        <Toggle checked={s.blockRedirects} onChange={(blockRedirects) => set({ blockRedirects })} label="Block automatic redirects" hint="Stops pages from sending you to another site without you clicking. You can allow a blocked redirect from the Shields panel." />
        <Toggle checked={s.blockNotifications} onChange={(blockNotifications) => set({ blockNotifications })} label="Block notification requests" hint="Websites are never allowed to ask to send you push notifications." />
        <Toggle checked={s.youtube} onChange={(youtube) => set({ youtube })} label="Skip and remove YouTube ads" hint="Removes ad data from YouTube's player and auto-skips any ad that gets through." />
      </Group>

      <Group title="Filter lists">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {engine ? (
              <>
                Engine: <strong>{engine.state}</strong>
                {engine.state === 'ready' && ` — ${engine.networkRules.toLocaleString()} network rules, ${engine.cosmeticRules.toLocaleString()} cosmetic rules, built ${ago(engine.builtAt)}`}
                {engine.state !== 'ready' && engine.message && ` — ${engine.message}`}
              </>
            ) : (
              'Loading…'
            )}
          </div>
          <button
            className="shrink-0 rounded-full px-4 py-2"
            style={{ border: '1px solid var(--border)' }}
            disabled={info?.updating}
            onClick={() => {
              void window.bmax.cmd('shields.refresh')
              window.setTimeout(load, 300)
            }}
          >
            {info?.updating ? 'Updating…' : 'Update now'}
          </button>
        </div>
        <Toggle
          checked={s.autoUpdate}
          onChange={(autoUpdate) => set({ autoUpdate })}
          label="Update lists automatically (every 12 hours, and at startup if stale)"
          hint="This is the only network traffic Shields makes. Turn it off and no filter lists are downloaded until you press “Update now”."
        />
        <ul className="mt-2">
          {main.map((l) => (
            <li key={l.id}>
              <Toggle checked={l.enabled} onChange={(on) => setList(l.id, on)} label={l.name} hint={`${l.note ? l.note + ' · ' : ''}${l.fetchedAt ? 'updated ' + ago(l.fetchedAt) : 'not downloaded yet'}`} />
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Regional lists">
        <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
          Add a list for your language or region. They are downloaded only after you turn them on.
        </p>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {regional.map((l) => (
            <li key={l.id}>
              <Toggle checked={l.enabled} onChange={(on) => setList(l.id, on)} label={l.name} />
            </li>
          ))}
        </ul>
      </Group>

      <RulesEditor />

      <Group title="Sites with Shields turned off">
        {s.disabledSites.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>None.</p>
        ) : (
          <ul>
            {s.disabledSites.map((site) => (
              <li key={site} className="flex items-center justify-between py-1">
                <span>{site}</span>
                <button className="rounded-full px-3 py-1 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => set({ disabledSites: s.disabledSites.filter((x) => x !== site) })}>
                  Turn on
                </button>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  )
}
