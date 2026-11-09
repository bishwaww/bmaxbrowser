import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolStatus } from '@shared/downloads'
import type { Settings, SettingsPatch } from '@shared/settings'

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

export function DownloadsSection({ settings, update }: { settings: Settings; update: (p: SettingsPatch) => void }) {
  const d = settings.downloads
  const [tools, setTools] = useState<{ ytdlp: ToolStatus; ffmpeg: ToolStatus } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Settings['downloads']>) => update({ downloads: { ...d, ...patch } })
  const load = () => void window.bmax.cmd('downloads.tools').then(setTools)
  useEffect(load, [])

  return (
    <>
      <Group title="Where files are saved">
        <div className="flex items-center justify-between gap-3">
          <code className="min-w-0 flex-1 truncate" style={{ userSelect: 'text' }} title={d.folder}>
            {d.folder || 'Your system Downloads folder'}
          </code>
          <button
            className="shrink-0 rounded-full px-4 py-2"
            style={{ border: '1px solid var(--border)' }}
            onClick={async () => {
              const p = await window.bmax.cmd('downloads.chooseFolder')
              if (p) set({ folder: p })
            }}
          >
            Change…
          </button>
          {d.folder && (
            <button className="shrink-0 rounded-full px-3 py-2 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => set({ folder: '' })}>
              Reset
            </button>
          )}
        </div>
        <Toggle checked={d.askWhere} onChange={(askWhere) => set({ askWhere })} label="Ask where to save each file" hint="Applies to ordinary file downloads. Video downloads always use the folder above." />
        <label className="flex items-center justify-between gap-6 py-1.5">
          <span>Downloads at the same time</span>
          <select
            aria-label="Concurrent downloads"
            value={d.maxConcurrent}
            onChange={(e) => set({ maxConcurrent: Number(e.target.value) })}
            className="rounded-md px-2 py-1"
            style={{ background: 'var(--field)', border: '1px solid var(--border)' }}
          >
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </Group>

      <Group title="Video downloader (yt-dlp + ffmpeg)">
        <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
          yt-dlp: {tools ? (tools.ytdlp.present ? tools.ytdlp.version : 'not installed') : '…'}
          {tools?.ytdlp.checkedAt ? ` · last update check ${new Date(tools.ytdlp.checkedAt).toLocaleString()}` : ''}
          <br />
          ffmpeg: {tools ? (tools.ffmpeg.present ? tools.ffmpeg.version : 'not installed') : '…'}
        </p>
        <Toggle
          checked={d.autoUpdateYtdlp}
          onChange={(autoUpdateYtdlp) => set({ autoUpdateYtdlp })}
          label="Keep yt-dlp up to date"
          hint="Checks GitHub for a new yt-dlp about once a day (sites change often). yt-dlp verifies the update itself. This and the filter-list updates are BMAX's only background network requests."
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            className="rounded-full px-4 py-2 disabled:opacity-40"
            style={{ border: '1px solid var(--border)' }}
            disabled={busy || !tools?.ytdlp.present}
            onClick={async () => {
              setBusy(true)
              setMsg('Checking…')
              const r = await window.bmax.cmd('downloads.updateYtdlp')
              setMsg(r.message)
              setBusy(false)
              load()
            }}
          >
            Update yt-dlp now
          </button>
          {msg && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {msg}
            </span>
          )}
        </div>
      </Group>
    </>
  )
}
