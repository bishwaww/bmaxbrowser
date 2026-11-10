import { useEffect, useState } from 'react'
import type { AppInfo, UpdateState } from '@shared/updates'
import { Button, Group } from './ui'

function updateText(u: UpdateState): string {
  switch (u.status) {
    case 'checking':
      return 'Checking for updates…'
    case 'none':
      return 'BMAX is up to date.'
    case 'available':
      return `Version ${u.version ?? ''} is available.`
    case 'downloading':
      return `Downloading version ${u.version ?? ''}… ${u.progress ?? 0}%`
    case 'downloaded':
      return `Version ${u.version ?? ''} is ready to install.`
    case 'unsupported':
      return u.message ?? 'Updates are not available for this build.'
    case 'error':
      return `Could not check for updates: ${u.message ?? 'unknown error'}`
    default:
      return ''
  }
}

export function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    void window.bmax.cmd('app.info').then((i) => {
      setInfo(i)
      setUpdate(i.updates)
    })
    return window.bmax.onPush((m) => {
      if (m.type === 'updates') setUpdate(m.state)
    })
  }, [])
  const busy = update.status === 'checking' || update.status === 'downloading'
  return (
    <>
      <Group title="BMAX Browser">
        <p data-testid="version">
          Version <strong>{info?.version ?? '…'}</strong>
          {info && !info.packaged ? ' (development build)' : ''}
        </p>
        {info && (
          <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
            Chromium {info.chrome} · Electron {info.electron} · Node {info.node} · {info.platform} {info.arch}
          </p>
        )}
        <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
          A privacy-first browser. No telemetry, no analytics, no crash reporting.
        </p>
      </Group>

      <Group title="Updates">
        <p role="status" data-testid="update-status" className="mb-3">
          {updateText(update) || 'Check whether a newer version is available.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void window.bmax.cmd('updates.check').then(setUpdate)}>
            Check for updates
          </Button>
          {update.status === 'available' && (
            <Button primary onClick={() => void window.bmax.cmd('updates.download').then(setUpdate)}>
              Download update
            </Button>
          )}
          {update.status === 'downloaded' && (
            <Button primary onClick={() => void window.bmax.cmd('updates.install')}>
              Restart and install
            </Button>
          )}
        </div>
      </Group>

      <Group title="Privacy and licences">
        <p className="mb-3" style={{ color: 'var(--muted)' }}>
          What BMAX stores, what it sends, and which parts talk to the network.
        </p>
        <Button onClick={() => void window.bmax.cmd('page.navigate', { input: 'bmax://privacy' })}>Read the privacy policy</Button>
        <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>
          BMAX is built on Chromium and Electron and includes open-source components (Ghostery adblocker, WebTorrent, Mozilla Readability, Tor, yt-dlp
          and FFmpeg). See docs/THIRD_PARTY.md in the source for their licences.
        </p>
      </Group>
    </>
  )
}
