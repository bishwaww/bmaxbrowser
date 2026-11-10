import { useEffect, useState } from 'react'
import type { ExtensionInfo } from '@shared/extensions'
import { Button, Group } from './ui'

export function ExtensionsSection() {
  const [list, setList] = useState<ExtensionInfo[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => void window.bmax.cmd('extensions.list').then(setList)
  useEffect(load, [])

  const run = async (p: Promise<{ ok: boolean; message?: string | undefined }>) => {
    setBusy(true)
    try {
      const r = await p
      setMsg(r.message ?? '')
    } catch (err) {
      setMsg(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : 'Something went wrong.')
    } finally {
      setBusy(false)
      load()
    }
  }

  return (
    <>
      <Group title="Install an extension">
        <p className="mb-3" style={{ color: 'var(--muted)' }}>
          Add a Chrome extension from a folder (an unpacked extension) or a package file (.crx or .zip). You will see what it can access before it is
          installed. BMAX has no extension store and does not verify who published a package: install only extensions you trust.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run(window.bmax.cmd('extensions.installUnpacked'))}>
            Load unpacked folder…
          </Button>
          <Button disabled={busy} onClick={() => void run(window.bmax.cmd('extensions.installCrx'))}>
            Install from .crx / .zip…
          </Button>
        </div>
        {msg && (
          <p role="status" className="mt-3 text-sm">
            {msg}
          </p>
        )}
      </Group>

      <Group title="Using extensions">
        <p className="mb-3" style={{ color: 'var(--muted)' }}>
          Extensions run only in a <strong>window with extensions</strong> (Ctrl+Shift+E), marked EXT in the toolbar. Your normal windows never run them.
        </p>
        <Button onClick={() => void window.bmax.cmd('window.action', { name: 'newExtensionWindow' })}>New window with extensions</Button>
      </Group>

      <Group title="Installed extensions">
        {list === null ? null : list.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No extensions installed.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {list.map((e) => (
              <li key={e.id} data-extension={e.name} className="flex flex-col gap-1" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div className="flex items-center justify-between gap-4">
                  <strong>
                    {e.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{e.version}</span>
                  </strong>
                  <label className="flex items-center gap-2 text-sm">
                    Enabled
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Enable ${e.name}`}
                      checked={e.enabled}
                      onChange={(ev) => void run(window.bmax.cmd('extensions.setEnabled', { id: e.id, enabled: ev.target.checked }))}
                    />
                  </label>
                </div>
                {e.description && (
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>
                    {e.description}
                  </span>
                )}
                {e.error && (
                  <span className="text-sm" style={{ color: 'var(--danger)' }}>
                    {e.error}
                  </span>
                )}
                {e.permissions.length > 0 && (
                  <ul className="list-disc pl-5 text-xs" style={{ color: e.allSites ? 'var(--danger)' : 'var(--muted)' }}>
                    {e.permissions.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  {e.optionsPage && e.enabled && <Button onClick={() => void run(window.bmax.cmd('extensions.open', { id: e.id, page: 'options' }).then(() => ({ ok: true })))}>Open options</Button>}
                  {e.popupPage && e.enabled && <Button onClick={() => void run(window.bmax.cmd('extensions.open', { id: e.id, page: 'popup' }).then(() => ({ ok: true })))}>Open popup</Button>}
                  <Button danger disabled={busy} onClick={() => void run(window.bmax.cmd('extensions.remove', { id: e.id }))}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="What works, and what does not">
        <ul className="list-disc space-y-1 pl-5" style={{ color: 'var(--muted)' }}>
          <li>BMAX uses Electron&rsquo;s built-in extension support: content scripts, background workers and the part of the chrome.* API that Electron provides.</li>
          <li>There are no toolbar buttons. An extension&rsquo;s popup opens in a tab (&ldquo;Open popup&rdquo;). Many chrome.tabs / chrome.windows features are missing, so some extensions will not work.</li>
          <li>
            Why a separate window: Electron can only run extensions in a session that is stored on disk, while normal BMAX windows keep everything in memory. A window with
            extensions therefore uses a <strong>temporary profile on disk</strong> (cookies, cache and site data). It is wiped when its last tab closes and on Burn, and deleted again
            at the next start.
          </li>
          <li>Extensions never run in normal windows, Tor windows, isolated windows or container tabs.</li>
          <li>Blocker-style Manifest&nbsp;V2 extensions (such as classic uBlock Origin) are not supported. Shields already blocks ads and trackers.</li>
          <li>Installed extensions are stored in the app data folder. Burn clears their data but does not uninstall them.</li>
        </ul>
      </Group>
    </>
  )
}
