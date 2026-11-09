import { useCallback, useEffect, useState } from 'react'
import { formatBytes, formatEta } from '@shared/downloads'
import type { DownloadJob } from '@shared/downloads'
import { IconClose, IconDownload, IconFolder, IconPause, IconPlay, IconReload } from '../shared-ui/icons'

type Action = 'pause' | 'resume' | 'cancel' | 'remove' | 'open' | 'show' | 'retry'

function describe(j: DownloadJob): string {
  const parts: string[] = []
  if (j.state === 'error') return j.error ?? 'Failed'
  if (j.state === 'cancelled') return 'Cancelled'
  if (j.state === 'queued') return 'Waiting…'
  if (j.state === 'done') {
    parts.push(j.kind === 'images' ? `${j.fileCount} image${j.fileCount === 1 ? '' : 's'} saved` : j.fileCount > 1 ? `${j.fileCount} files saved` : `Done${j.total ? ` — ${formatBytes(j.total)}` : j.bytes ? ` — ${formatBytes(j.bytes)}` : ''}`)
    return parts.join(' · ')
  }
  if (j.stage) parts.push(j.stage)
  if (j.kind === 'images') parts.push(`${j.bytes}/${j.total ?? '?'}`)
  else if (j.total) parts.push(`${formatBytes(j.bytes)} of ${formatBytes(j.total)}`)
  else if (j.bytes) parts.push(formatBytes(j.bytes))
  if (j.state === 'downloading' && j.speed) parts.push(`${formatBytes(j.speed)}/s`)
  if (j.state === 'downloading' && j.eta !== null) parts.push(`${formatEta(j.eta)} left`)
  return parts.join(' · ')
}

function Btn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-btn" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  )
}

function Row({ job, act }: { job: DownloadJob; act: (id: string, a: Action) => void }) {
  const active = ['queued', 'starting', 'downloading', 'processing'].includes(job.state)
  const color = job.state === 'error' ? 'var(--danger)' : job.state === 'done' ? 'var(--ok)' : 'var(--accent)'
  const pct = job.progress >= 0 ? Math.round(job.progress * 100) : null
  return (
    <li className="rounded-xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        <span style={{ color: 'var(--muted)', paddingTop: 2 }}>
          <IconDownload size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={job.title} style={{ userSelect: 'text' }}>
            {job.title}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: job.state === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
            {describe(job)}
            {job.viaTor && <span className="ml-2 rounded px-1" style={{ background: 'var(--active)' }}>via Tor</span>}
          </div>
          {(active || job.state === 'paused') && (
            <div className="mt-2 overflow-hidden rounded-full" style={{ height: 6, background: 'var(--field)' }} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
              <div
                style={{
                  height: '100%',
                  width: pct === null ? '35%' : `${pct}%`,
                  background: job.state === 'paused' ? 'var(--muted)' : color,
                  transition: 'width 200ms',
                  animation: pct === null && job.state !== 'paused' ? 'bmax-indeterminate 1.2s ease-in-out infinite' : undefined
                }}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {(job.state === 'downloading' || job.state === 'starting') && job.kind !== 'images' && (
            <Btn title="Pause" onClick={() => act(job.id, 'pause')}>
              <IconPause size={16} />
            </Btn>
          )}
          {job.state === 'paused' && (
            <Btn title="Resume" onClick={() => act(job.id, 'resume')}>
              <IconPlay size={16} />
            </Btn>
          )}
          {(active || job.state === 'paused') && (
            <Btn title="Cancel" onClick={() => act(job.id, 'cancel')}>
              <IconClose size={16} />
            </Btn>
          )}
          {(job.state === 'error' || job.state === 'cancelled') && job.kind !== 'file' && job.kind !== 'images' && (
            <Btn title="Retry" onClick={() => act(job.id, 'retry')}>
              <IconReload size={16} />
            </Btn>
          )}
          {job.state === 'done' && (
            <>
              <button className="rounded-full px-3 py-1 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => act(job.id, 'open')}>
                Open
              </button>
              <Btn title="Show in folder" onClick={() => act(job.id, 'show')}>
                <IconFolder size={16} />
              </Btn>
            </>
          )}
          {['done', 'error', 'cancelled'].includes(job.state) && (
            <Btn title="Remove from list" onClick={() => act(job.id, 'remove')}>
              <IconClose size={14} />
            </Btn>
          )}
        </div>
      </div>
    </li>
  )
}

export function App() {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const load = useCallback(() => void window.bmax.cmd('downloads.list').then(setJobs), [])
  useEffect(() => {
    load()
    return window.bmax.onPush((m) => {
      if (m.type === 'downloads') setJobs(m.jobs)
    })
  }, [load])

  const act = (id: string, a: Action): void => {
    void window.bmax.cmd('downloads.action', { id, action: a }).then(load)
  }
  const finished = jobs.filter((j) => ['done', 'error', 'cancelled'].includes(j.state)).length

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--field)', userSelect: 'text' }}>
      <style>{'@keyframes bmax-indeterminate { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }'}</style>
      <main className="mx-auto max-w-3xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Downloads</h1>
          <button
            className="rounded-full px-4 py-2 disabled:opacity-40"
            style={{ border: '1px solid var(--border)' }}
            disabled={finished === 0}
            onClick={() => void window.bmax.cmd('downloads.clear').then(load)}
          >
            Clear finished
          </button>
        </div>
        {jobs.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>Nothing downloaded yet. Use the download button in the address bar on pages with video, audio or images.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {jobs.map((j) => (
              <Row key={j.id} job={j} act={act} />
            ))}
          </ul>
        )}
        <p className="mt-8 text-xs" style={{ color: 'var(--muted)' }}>
          This list is kept in memory only and is cleared when BMAX closes or you press Burn. The files themselves stay in your download folder.
        </p>
      </main>
    </div>
  )
}
