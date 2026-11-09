import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes, formatEta } from '@shared/downloads'
import { isVideoOrAudio } from '@shared/torrents'
import type { TorrentFileInfo, TorrentInfo, TorrentsStatus } from '@shared/torrents'
import { IconClose, IconFolder, IconPause, IconPlay } from '../shared-ui/icons'

const field = { background: 'var(--field)', border: '1px solid var(--border)', userSelect: 'text' as const }
const primary = { background: 'var(--accent)', color: 'var(--on-accent)' }
const errText = (e: unknown): string => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

const STATE_LABEL: Record<TorrentInfo['state'], string> = {
  metadata: 'Getting torrent info…',
  selecting: 'Choose files',
  downloading: 'Downloading',
  seeding: 'Seeding',
  paused: 'Paused',
  finished: 'Finished',
  error: 'Error'
}

function Warning({ status }: { status: TorrentsStatus }) {
  return (
    <div role="alert" className="mb-5 rounded-xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--danger)' }}>
      <div className="mb-1 font-semibold" style={{ color: 'var(--danger)' }}>
        Torrent traffic is NOT routed through Tor and exposes your IP address
      </div>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Every peer and tracker you connect to can see your real IP address and which torrents you download or share. Tor is never used for torrents
        {status.proxyEnabled ? ', and the proxy set in BMAX settings does not apply to them either' : ''}. Use a VPN at the operating-system level if you need to hide your address.
        Torrents are switched off entirely in Tor windows.
      </p>
    </div>
  )
}

function FileRow({ f, checked, onToggle, disabled, onPlay, onOpen }: { f: TorrentFileInfo; checked: boolean; onToggle: () => void; disabled: boolean; onPlay: () => void; onOpen: () => void }) {
  const done = f.progress >= 0.999
  return (
    <li className="flex items-center gap-3 py-1" style={{ fontSize: 12 }}>
      <input type="checkbox" aria-label={`Download ${f.path}`} checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="min-w-0 flex-1 truncate" title={f.path} style={{ userSelect: 'text' }}>
        {f.path}
      </span>
      <span style={{ color: 'var(--muted)', width: 70, textAlign: 'right' }}>{formatBytes(f.length)}</span>
      <span style={{ color: done ? 'var(--ok)' : 'var(--muted)', width: 44, textAlign: 'right' }}>{checked ? `${Math.round(f.progress * 100)}%` : '–'}</span>
      <span className="flex w-24 justify-end gap-1">
        {isVideoOrAudio(f.name) && (
          <button className="rounded-full px-2 py-0.5 text-[11px]" style={{ border: '1px solid var(--border)' }} onClick={onPlay} title="Play while downloading">
            Play
          </button>
        )}
        {done && (
          <button className="rounded-full px-2 py-0.5 text-[11px]" style={{ border: '1px solid var(--border)' }} onClick={onOpen}>
            Open
          </button>
        )}
      </span>
    </li>
  )
}

function Card({
  t,
  onPlay,
  refresh,
  setError
}: {
  t: TorrentInfo
  onPlay: (t: TorrentInfo, f: TorrentFileInfo) => void
  refresh: () => void
  setError: (m: string) => void
}) {
  const [open, setOpen] = useState(t.state === 'selecting')
  const [pick, setPick] = useState<Set<number> | null>(null)
  const selecting = t.state === 'selecting'
  const selected = pick ?? new Set(selecting ? t.files.map((f) => f.index) : t.files.filter((f) => f.selected).map((f) => f.index))
  const call = (p: Promise<unknown>): void => void p.then(refresh).catch((e) => setError(errText(e)))
  const pct = Math.round(t.progress * 100)

  useEffect(() => {
    if (selecting) setOpen(true)
  }, [selecting])

  const toggle = (i: number): void => {
    const next = new Set(selected)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setPick(next)
    if (!selecting) call(window.bmax.cmd('torrents.setFiles', { id: t.id, files: [...next] }))
  }

  return (
    <li className="rounded-xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={t.name} style={{ userSelect: 'text' }}>
            {t.name}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs" style={{ color: t.state === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
            <span>{t.state === 'error' && t.error ? t.error : STATE_LABEL[t.state]}</span>
            {t.length > 0 && <span>{formatBytes(t.downloaded)} of {formatBytes(t.length)}</span>}
            {t.state === 'downloading' && <span>↓ {formatBytes(t.downloadSpeed)}/s</span>}
            {(t.state === 'downloading' || t.state === 'seeding') && <span>↑ {formatBytes(t.uploadSpeed)}/s</span>}
            {t.state !== 'metadata' && t.state !== 'error' && <span>{t.numPeers} peers</span>}
            <span>ratio {t.ratio.toFixed(2)}</span>
            {t.state === 'downloading' && t.eta !== null && <span>{formatEta(t.eta)} left</span>}
          </div>
          {['downloading', 'paused', 'metadata', 'seeding'].includes(t.state) && (
            <div className="mt-2 overflow-hidden rounded-full" style={{ height: 6, background: 'var(--field)' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ height: '100%', width: `${t.state === 'metadata' ? 8 : pct}%`, background: t.state === 'paused' ? 'var(--muted)' : t.state === 'seeding' ? 'var(--ok)' : 'var(--accent)', transition: 'width 300ms' }} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {t.state === 'paused' ? (
            <button className="icon-btn" title="Resume" aria-label="Resume" onClick={() => call(window.bmax.cmd('torrents.action', { id: t.id, action: 'resume' }))}>
              <IconPlay size={16} />
            </button>
          ) : (
            ['downloading', 'seeding', 'metadata'].includes(t.state) && (
              <button className="icon-btn" title="Pause" aria-label="Pause" onClick={() => call(window.bmax.cmd('torrents.action', { id: t.id, action: 'pause' }))}>
                <IconPause size={16} />
              </button>
            )
          )}
          {t.files.length > 0 && !selecting && (
            <button className="icon-btn" title="Show in folder" aria-label="Show in folder" onClick={() => call(window.bmax.cmd('torrents.action', { id: t.id, action: 'show' }))}>
              <IconFolder size={16} />
            </button>
          )}
          <button className="icon-btn" title="Remove from list" aria-label="Remove" onClick={() => call(window.bmax.cmd('torrents.action', { id: t.id, action: 'remove' }))}>
            <IconClose size={14} />
          </button>
        </div>
      </div>

      {t.files.length > 0 && (
        <div className="mt-2">
          <button className="text-xs" style={{ color: 'var(--accent)' }} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} files ({t.files.length})
          </button>
          {open && (
            <>
              {selecting && (
                <div className="mt-2 rounded-lg p-3" style={{ background: 'var(--field)' }}>
                  <div className="mb-2 text-sm font-semibold">Choose which files to download</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="rounded-full px-3 py-1 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => setPick(new Set(t.files.map((f) => f.index)))}>
                      Select all
                    </button>
                    <button className="rounded-full px-3 py-1 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => setPick(new Set())}>
                      Select none
                    </button>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {selected.size} of {t.files.length} files · {formatBytes(t.files.filter((f) => selected.has(f.index)).reduce((n, f) => n + f.length, 0))}
                    </span>
                    <button
                      className="ml-auto rounded-full px-4 py-1.5 disabled:opacity-40"
                      style={primary}
                      disabled={selected.size === 0}
                      onClick={() => call(window.bmax.cmd('torrents.start', { id: t.id, files: [...selected] }))}
                    >
                      Start download
                    </button>
                  </div>
                </div>
              )}
              <ul className="mt-2 max-h-72 overflow-y-auto">
                {t.files.map((f) => (
                  <FileRow
                    key={f.index}
                    f={f}
                    checked={selected.has(f.index)}
                    disabled={t.state === 'error'}
                    onToggle={() => toggle(f.index)}
                    onPlay={() => onPlay(t, f)}
                    onOpen={() => call(window.bmax.cmd('torrents.action', { id: t.id, action: 'open', file: f.index }))}
                  />
                ))}
              </ul>
              {!selecting && (
                <button className="mt-2 text-xs" style={{ color: 'var(--danger)' }} onClick={() => call(window.bmax.cmd('torrents.action', { id: t.id, action: 'removeFiles' }))}>
                  Remove and delete downloaded files
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}

export function App() {
  const [torrents, setTorrents] = useState<TorrentInfo[]>([])
  const [status, setStatus] = useState<TorrentsStatus | null>(null)
  const [magnet, setMagnet] = useState('')
  const [error, setError] = useState('')
  const [player, setPlayer] = useState<{ url: string; name: string; mime: string; torrent: string; file: number } | null>(null)
  const [playerError, setPlayerError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  const load = useCallback(() => {
    void window.bmax.cmd('torrents.list').then((r) => {
      setTorrents(r.torrents)
      setStatus(r.status)
    })
  }, [])
  useEffect(() => {
    load()
    return window.bmax.onPush((m) => {
      if (m.type === 'torrents') {
        setTorrents(m.torrents)
        setStatus(m.status)
      }
    })
  }, [load])

  const play = async (t: TorrentInfo, f: TorrentFileInfo): Promise<void> => {
    setPlayerError('')
    try {
      const s = await window.bmax.cmd('torrents.stream', { id: t.id, file: f.index })
      setPlayer({ url: s.url, name: f.name, mime: s.mime, torrent: t.id, file: f.index })
    } catch (e) {
      setError(errText(e))
    }
  }

  if (!status) return null
  if (status.torDisabled) {
    return (
      <main className="mx-auto flex h-full max-w-xl flex-col justify-center px-8">
        <h1 className="mb-3 text-2xl font-semibold">Torrents are disabled in Tor windows</h1>
        <p style={{ color: 'var(--muted)' }}>
          Torrent traffic is not routed through Tor and would expose your real IP address to every peer, which defeats the purpose of a Tor window. Open a normal BMAX window to use
          torrents.
        </p>
      </main>
    )
  }

  const add = async (): Promise<void> => {
    setError('')
    try {
      await window.bmax.cmd('torrents.addMagnet', { uri: magnet })
      setMagnet('')
      load()
    } catch (e) {
      setError(errText(e))
    }
  }

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--field)', userSelect: 'text' }}>
      <main className="mx-auto max-w-3xl p-8">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Torrents</h1>
          <div className="flex gap-2">
            <button
              className="rounded-full px-4 py-2 disabled:opacity-40"
              style={{ border: '1px solid var(--border)' }}
              disabled={!torrents.some((t) => ['finished', 'error'].includes(t.state))}
              onClick={() => void window.bmax.cmd('torrents.clear').then(load)}
            >
              Clear finished
            </button>
            <button className="rounded-full px-4 py-2" style={{ border: '1px solid var(--border)' }} onClick={() => void window.bmax.cmd('tab.new', { url: 'bmax://settings/?section=Torrents' })}>
              Settings
            </button>
          </div>
        </div>

        <Warning status={status} />

        <form
          className="mb-5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (magnet.trim()) void add()
          }}
        >
          <input aria-label="Magnet link" placeholder="Paste a magnet link" value={magnet} onChange={(e) => setMagnet(e.target.value)} className="min-w-0 flex-1 rounded-full px-4 py-2" style={field} />
          <button type="submit" className="rounded-full px-5 py-2 disabled:opacity-40" style={primary} disabled={!magnet.trim()}>
            Add
          </button>
          <button
            type="button"
            className="rounded-full px-4 py-2"
            style={{ border: '1px solid var(--border)' }}
            onClick={() => {
              setError('')
              void window.bmax.cmd('torrents.addFile').then(load).catch((e) => setError(errText(e)))
            }}
          >
            Open .torrent file…
          </button>
        </form>
        {error && (
          <p role="status" className="mb-4 text-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        {player && (
          <section className="mb-5 rounded-xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }} aria-label="Player">
            <div className="mb-2 flex items-center justify-between">
              <div className="truncate text-sm font-medium">{player.name}</div>
              <button className="icon-btn" aria-label="Close player" onClick={() => setPlayer(null)}>
                <IconClose size={16} />
              </button>
            </div>
            {player.mime.startsWith('audio/') ? (
              <audio key={player.url} ref={videoRef as never} src={player.url} controls autoPlay style={{ width: '100%' }} onError={() => setPlayerError('This audio format cannot be played here.')} />
            ) : (
              <video key={player.url} ref={videoRef} src={player.url} controls autoPlay style={{ width: '100%', maxHeight: 420, background: '#000' }} onError={() => setPlayerError('This video format cannot be played in BMAX.')} />
            )}
            {playerError && (
              <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>
                {playerError}{' '}
                <button className="underline" onClick={() => void window.bmax.cmd('torrents.action', { id: player.torrent, action: 'open', file: player.file })}>
                  Open with your system player once downloaded
                </button>
              </p>
            )}
            <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
              Streaming while downloading: playback starts as soon as the first pieces arrive.
            </p>
          </section>
        )}

        {torrents.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No torrents. Click a magnet link on any page, open a .torrent file, or paste a magnet link above.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {torrents.map((t) => (
              <Card key={t.id} t={t} onPlay={(tt, f) => void play(tt, f)} refresh={load} setError={setError} />
            ))}
          </ul>
        )}

        <p className="mt-8 text-xs" style={{ color: 'var(--muted)' }}>
          This list lives in memory only: it is cleared when BMAX closes or you press Burn, and sharing stops. Downloaded files stay in {status.folder}.
        </p>
      </main>
    </div>
  )
}
