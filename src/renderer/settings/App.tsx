import { useState } from 'react'
import type { ReactNode } from 'react'
import { DOH_PROVIDERS } from '@shared/privacy'
import type { DohProviderId } from '@shared/privacy'
import { SEARCH_ENGINES } from '@shared/search-engines'
import type { Settings, SettingsPatch } from '@shared/settings'
import { useSettings } from '../shared-ui/hooks'
import { DownloadsSection } from './DownloadsSection'
import { ShieldsSection } from './ShieldsSection'
import { TorrentsSection } from './TorrentsSection'

const SECTIONS = ['Appearance', 'Search', 'Shields', 'Privacy & Security', 'Downloads', 'Torrents', 'Network', 'Tor', 'About'] as const
type Section = (typeof SECTIONS)[number]

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

function Radio<T extends string>({
  name,
  value,
  options,
  onChange
}: {
  name: string
  value: T
  options: { value: T; label: string; hint?: string | undefined }[]
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

function NetworkSection({ settings, update }: { settings: Settings; update: (p: SettingsPatch) => void }) {
  const doh = settings.privacy.doh
  const proxy = settings.proxy
  const setDoh = (patch: Partial<typeof doh>) => update({ privacy: { ...settings.privacy, doh: { ...doh, ...patch } } })
  const [host, setHost] = useState(proxy.host)
  const [port, setPort] = useState(String(proxy.port))
  const [dohCustom, setDohCustom] = useState(doh.customUrl)
  return (
    <>
      <Group title="DNS over HTTPS">
        <Toggle
          checked={doh.mode === 'secure'}
          onChange={(on) => setDoh({ mode: on ? 'secure' : 'off' })}
          label="Always use secure DNS"
          hint="Website names are looked up only through the provider below. If it can't be reached, pages fail to load instead of falling back to your ISP's DNS."
        />
        {doh.mode === 'secure' && (
          <div className="mt-3">
            <Radio<DohProviderId>
              name="doh"
              value={doh.provider}
              onChange={(provider) => setDoh({ provider })}
              options={(Object.keys(DOH_PROVIDERS) as DohProviderId[]).map((id) => ({ value: id, label: DOH_PROVIDERS[id].name }))}
            />
            {(doh.provider === 'nextdns' || doh.provider === 'custom') && (
              <div className="mt-3 flex gap-2">
                <input
                  aria-label={doh.provider === 'nextdns' ? 'NextDNS profile ID' : 'DoH server URL'}
                  placeholder={doh.provider === 'nextdns' ? 'NextDNS profile ID (e.g. abc123)' : 'https://dns.example/dns-query'}
                  value={dohCustom}
                  onChange={(e) => setDohCustom(e.target.value)}
                  className="min-w-0 flex-1 rounded-md px-3 py-2"
                  style={inputStyle}
                />
                <button className="rounded-full px-4" style={{ border: '1px solid var(--border)' }} onClick={() => setDoh({ customUrl: dohCustom })}>
                  Save
                </button>
              </div>
            )}
          </div>
        )}
      </Group>

      <Group title="Proxy / VPN (normal windows)">
        <Toggle
          checked={proxy.enabled}
          onChange={(enabled) => update({ proxy: { ...proxy, enabled } })}
          label="Route normal windows through a proxy"
          hint="If the proxy is down or misconfigured, pages fail to load; they never fall back to a direct connection. Tor windows ignore this setting."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Proxy type"
            value={proxy.scheme}
            onChange={(e) => update({ proxy: { ...proxy, scheme: e.target.value as Settings['proxy']['scheme'] } })}
            className="rounded-md px-2 py-2"
            style={inputStyle}
          >
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
          <input aria-label="Proxy host" value={host} onChange={(e) => setHost(e.target.value)} className="w-56 rounded-md px-3 py-2" style={inputStyle} />
          <input aria-label="Proxy port" value={port} onChange={(e) => setPort(e.target.value)} className="w-24 rounded-md px-3 py-2" style={inputStyle} />
          <button
            className="rounded-full px-4 py-2"
            style={{ border: '1px solid var(--border)' }}
            onClick={() => {
              const p = Number(port)
              if (Number.isInteger(p) && p >= 1 && p <= 65535) update({ proxy: { ...proxy, host: host.trim(), port: p } })
            }}
          >
            Apply
          </button>
        </div>
      </Group>
    </>
  )
}

function TorSection() {
  return (
    <>
      <Group title="Tor windows">
        <p className="mb-3">
          Open a Tor window with <strong>Ctrl+Alt+N</strong> (or from the menu). Everything in that window goes through the Tor network, and no page loads until
          Tor is fully connected.
        </p>
        <button
          className="rounded-full px-5 py-2"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          onClick={() => void window.bmax.cmd('window.action', { name: 'newTorWindow' })}
        >
          Open a Tor window
        </button>
      </Group>
      <Group title="What Tor mode does, and does not, do">
        <ul className="list-disc space-y-1 pl-5" style={{ color: 'var(--muted)' }}>
          <li>Hides your IP address from the sites you visit and your local network from them.</li>
          <li>Looks up website names through Tor (no DNS leaks), disables WebRTC, denies all permission requests, and upgrades to HTTPS.</li>
          <li>Does not make this browser look the same as every other Tor Browser user. For the strongest anonymity, use the official Tor Browser.</li>
          <li>Torrents and torrent downloads are disabled in Tor windows. Torrent traffic is never routed through Tor.</li>
          <li>&ldquo;New Tor circuit&rdquo; asks Tor for fresh circuits for all Tor windows, then reloads the current page.</li>
        </ul>
      </Group>
    </>
  )
}

export function App() {
  const settings = useSettings()
  const [section, setSection] = useState<Section>(() => {
    const q = new URLSearchParams(location.search).get('section')
    return (SECTIONS as readonly string[]).includes(q ?? '') ? (q as Section) : 'Appearance'
  })
  if (!settings) return null
  const update = (patch: SettingsPatch) => void window.bmax.cmd('settings.update', patch)
  const setPrivacy = (patch: Partial<Settings['privacy']>) => update({ privacy: { ...settings.privacy, ...patch } })

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
      <main className="min-w-0 flex-1 overflow-y-auto p-8" style={{ maxWidth: 760 }}>
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
            <Group title="Protections">
              <Toggle
                checked={settings.privacy.httpsOnly}
                onChange={(httpsOnly) => setPrivacy({ httpsOnly })}
                label="HTTPS-Only mode"
                hint="Upgrades every request to HTTPS and shows a warning before ever loading a site over HTTP."
              />
              <Toggle
                checked={settings.privacy.blockThirdPartyCookies}
                onChange={(blockThirdPartyCookies) => setPrivacy({ blockThirdPartyCookies })}
                label="Block third-party cookies"
                hint="Embedded content from other sites can't set or read cookies. Storage is also partitioned per site."
              />
              <Toggle
                checked={settings.privacy.stripTrackingParams}
                onChange={(stripTrackingParams) => setPrivacy({ stripTrackingParams })}
                label="Remove tracking parameters from links"
                hint="Strips utm_*, fbclid, gclid, mc_eid, igshid and similar from the addresses you open."
              />
              <Toggle
                checked={settings.privacy.fingerprintProtection}
                onChange={(fingerprintProtection) => setPrivacy({ fingerprintProtection })}
                label="Fingerprinting protection"
                hint="Adds per-site noise to canvas, WebGL and audio, and limits what sites can learn about your device. A few sites may misbehave."
              />
              <Toggle
                checked={settings.privacy.uniformUserAgent}
                onChange={(uniformUserAgent) => setPrivacy({ uniformUserAgent })}
                label="Uniform browser identity"
                hint="Reports a common Chrome user agent, minimal client hints and English language settings."
              />
              <Toggle
                checked={settings.privacy.sendGpc}
                onChange={(sendGpc) => setPrivacy({ sendGpc })}
                label="Send Global Privacy Control"
                hint="Tells sites not to sell or share your data. (BMAX never sends Do Not Track.)"
              />
            </Group>
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
                hint="Off by default. Turning this off also deletes the saved file."
              />
            </Group>
            <Group title="Bookmarks & passwords">
              <p className="mb-3" style={{ color: 'var(--muted)' }}>
                Off until you set up the local encrypted vault.
              </p>
              <button
                className="rounded-full px-4 py-2"
                style={{ border: '1px solid var(--border)' }}
                onClick={() => void window.bmax.cmd('page.navigate', { input: 'bmax://bookmarks' })}
              >
                Open bookmarks &amp; passwords
              </button>
            </Group>
            <Group title="Burn">
              <p className="mb-3" style={{ color: 'var(--muted)' }}>
                Instantly wipes all cookies, storage and cache, closes every tab and window, and locks the vault.
              </p>
              <button
                className="rounded-full px-4 py-2"
                style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}
                onClick={() => void window.bmax.cmd('window.action', { name: 'burn' })}
              >
                Burn all browsing data
              </button>
            </Group>
          </>
        )}

        {section === 'Shields' && <ShieldsSection settings={settings} update={update} />}
        {section === 'Downloads' && <DownloadsSection settings={settings} update={update} />}
        {section === 'Torrents' && <TorrentsSection settings={settings} update={update} />}
        {section === 'Network' && <NetworkSection settings={settings} update={update} />}
        {section === 'Tor' && <TorSection />}

        {section === 'About' && (
          <Group title="BMAX Browser">
            <p>Version 0.2.0 (development)</p>
            <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
              A privacy-first browser. No telemetry, no analytics, no crash reporting.
            </p>
          </Group>
        )}
      </main>
    </div>
  )
}
