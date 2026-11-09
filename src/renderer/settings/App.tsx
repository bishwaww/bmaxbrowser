import { useState } from 'react'
import type { ReactNode } from 'react'
import { SEARCH_ENGINES } from '@shared/search-engines'
import type { SettingsPatch } from '@shared/settings'
import { useSettings } from '../shared-ui/hooks'

const SECTIONS = ['Appearance', 'Search', 'Privacy & Security', 'About'] as const
type Section = (typeof SECTIONS)[number]

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

function Radio<T extends string>({
  name,
  value,
  options,
  onChange
}: {
  name: string
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-3">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            {o.label}
            {o.hint && (
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                {o.hint}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-6 py-1">
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

export function App() {
  const settings = useSettings()
  const [section, setSection] = useState<Section>('Appearance')
  if (!settings) return null
  const update = (patch: SettingsPatch) => void window.bmax.cmd('settings.update', patch)

  return (
    <div className="flex h-full" style={{ background: 'var(--field)', userSelect: 'text' }}>
      <nav className="w-56 shrink-0 p-4" aria-label="Settings sections">
        <h1 className="mb-4 px-3 text-lg font-semibold">Settings</h1>
        {SECTIONS.map((s) => (
          <button
            key={s}
            className="mb-1 block w-full rounded-full px-4 py-2 text-left"
            style={{ background: s === section ? 'var(--active)' : undefined }}
            aria-current={s === section}
            onClick={() => setSection(s)}
          >
            {s}
          </button>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto p-8" style={{ maxWidth: 720 }}>
        <h1 className="mb-6 text-xl font-semibold">{section}</h1>

        {section === 'Appearance' && (
          <>
            <Group title="Theme">
              <Radio
                name="theme"
                value={settings.theme}
                onChange={(theme) => update({ theme })}
                options={[
                  { value: 'system', label: 'Use system setting' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' }
                ]}
              />
            </Group>
            <Group title="Toolbar">
              <Toggle checked={settings.showHomeButton} onChange={(showHomeButton) => update({ showHomeButton })} label="Show home button" />
            </Group>
          </>
        )}

        {section === 'Search' && (
          <Group title="Default search engine">
            <Radio
              name="engine"
              value={settings.searchEngine}
              onChange={(searchEngine) => update({ searchEngine })}
              options={SEARCH_ENGINES.map((e) => ({
                value: e.id,
                label: e.name,
                hint: e.id === 'duckduckgo' ? 'Default — does not track your searches' : undefined
              }))}
            />
          </Group>
        )}

        {section === 'Privacy & Security' && (
          <>
            <Group title="Site permissions (camera, microphone, location, notifications)">
              <Radio
                name="perm"
                value={settings.permissions.defaultAction}
                onChange={(defaultAction) => update({ permissions: { ...settings.permissions, defaultAction } })}
                options={[
                  { value: 'ask', label: 'Ask me when a site wants to use a permission' },
                  { value: 'deny', label: 'Deny all permission requests', hint: 'Sites are never asked; requests fail silently' }
                ]}
              />
            </Group>
            <Group title="Remembering decisions">
              <Toggle
                checked={settings.permissions.persist}
                onChange={(persist) => update({ permissions: { ...settings.permissions, persist } })}
                label="Remember site permission decisions after BMAX closes"
                hint="Off by default: decisions are forgotten when the browser closes. Turning this off also deletes the saved file."
              />
            </Group>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              BMAX keeps no history, cookies or cache on disk. More privacy controls arrive in the next phase.
            </p>
          </>
        )}

        {section === 'About' && (
          <Group title="BMAX Browser">
            <p>Version 0.1.0 (development)</p>
            <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
              A privacy-first browser. No telemetry, no analytics, no crash reporting.
            </p>
          </Group>
        )}
      </main>
    </div>
  )
}
