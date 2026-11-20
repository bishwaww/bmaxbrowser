import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatBytes, IMAGE_THRESHOLDS, qualityLabel, qualityOptions } from '@shared/downloads'
import type { AudioFormat, Container, ImageSummary, MediaPanelInfo, ProbeResult, SniffedMedia } from '@shared/downloads'

const field = { background: 'var(--field)', border: '1px solid var(--border)' }
const primary = { background: 'var(--accent)', color: 'var(--on-accent)' }

function trimUrl(u: string): string {
  try {
    const x = new URL(u)
    const p = x.pathname.length > 28 ? `…${x.pathname.slice(-26)}` : x.pathname
    return `${x.hostname}${p}`
  } catch {
    return u.slice(0, 48)
  }
}

function dur(sec: number | null): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

const KIND_LABEL: Record<SniffedMedia['kind'], string> = { video: 'Video file', audio: 'Audio file', hls: 'HLS stream', dash: 'DASH stream' }

export function MediaView() {
  const [info, setInfo] = useState<MediaPanelInfo | null>(null)
  const [tab, setTab] = useState<'media' | 'images'>('media')
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState('')
  const [mode, setMode] = useState<'video' | 'audio'>('video')
  const [height, setHeight] = useState<number | null>(null)
  const [container, setContainer] = useState<Container>('mp4')
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('mp3')
  const [subs, setSubs] = useState(false)
  const [subLangs, setSubLangs] = useState<string[]>([])
  const [thumb, setThumb] = useState(false)
  const [playlist, setPlaylist] = useState(false)
  const [images, setImages] = useState<ImageSummary | null>(null)
  const [minWidth, setMinWidth] = useState<number>(300)
  const [msg, setMsg] = useState('')

  const runProbe = useCallback((url: string) => {
    setProbing(true)
    setProbeError('')
    setProbe(null)
    window.bmax
      .cmd('media.probe', { url })
      .then((p) => {
        setProbe(p)
        setPlaylist(p.isPlaylist && false)
      })
      .catch((e: Error) => setProbeError(e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')))
      .finally(() => setProbing(false))
  }, [])

  useEffect(() => {
    void window.bmax.cmd('media.info').then((i) => {
      setInfo(i)
      // Opening the panel is a request to download: always ask yt-dlp about the page (it knows far more sites than the page scan can detect).
      if (i.supported && i.ytdlp.present && !(i.viaTor && !i.torReady)) runProbe(i.url)
      if (i.summary.videos + i.summary.audios + i.summary.sniffed === 0 && i.summary.images > 0) setTab('images')
    })
    void window.bmax.cmd('media.images', { minWidth: 0 }).then(setImages)
  }, [runProbe])

  const heights = useMemo(() => qualityOptions(probe?.heights ?? []), [probe])
  const blocked = !!info && info.viaTor && !info.torReady

  const start = async (kind: 'video' | 'thumbnail'): Promise<void> => {
    if (!info || !probe) return
    setMsg('')
    try {
      await window.bmax.cmd('media.start', {
        kind,
        url: info.url,
        title: probe.title,
        options: { mode, height, container, audioFormat, subtitles: subs, subLangs, thumbnail: thumb, playlist }
      })
      setMsg(kind === 'thumbnail' ? 'Saving thumbnail… see Downloads (Ctrl+J).' : 'Added to Downloads (Ctrl+J).')
    } catch (e) {
      setMsg((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }

  const startSniffed = async (m: SniffedMedia): Promise<void> => {
    setMsg('')
    try {
      await window.bmax.cmd('media.start', { kind: 'sniffed', url: m.url, title: trimUrl(m.url) })
      setMsg('Added to Downloads (Ctrl+J).')
    } catch (e) {
      setMsg((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }

  if (!info) return <div style={{ padding: 16 }}>Loading…</div>
  const hasMedia = info.summary.videos + info.summary.audios + info.summary.sniffed > 0
  const toolsMissing = !info.ytdlp.present || !info.ffmpeg.present

  return (
    <div style={{ padding: 16, width: '100%', boxSizing: 'border-box' }} role="dialog" aria-label="Download media">
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <div style={{ fontSize: 14, fontWeight: 600 }}>Download</div>
          <div className="truncate" style={{ color: 'var(--muted)', fontSize: 12 }}>
            {info.title || info.url}
          </div>
        </div>
        <button
          className="shrink-0 rounded-full px-3 py-1 text-xs"
          style={{ border: '1px solid var(--border)' }}
          onClick={() => {
            void window.bmax.cmd('window.action', { name: 'downloads' })
          }}
        >
          Downloads
        </button>
      </div>

      {!info.supported && <p style={{ color: 'var(--muted)' }}>Downloads are available on web pages.</p>}
      {blocked && (
        <p className="mb-2 rounded-lg p-2" style={{ background: 'var(--field)', fontSize: 12 }}>
          Tor is not connected yet, so nothing can be downloaded from this window. Downloads in a Tor window go through Tor.
        </p>
      )}
      {toolsMissing && (
        <p className="mb-2 rounded-lg p-2" style={{ background: 'var(--field)', fontSize: 12 }}>
          {!info.ytdlp.present ? 'yt-dlp is not installed' : 'ffmpeg is not installed'} — only plain file downloads and images are available (see docs/BINARIES.md).
        </p>
      )}

      {info.supported && (
        <>
          <div className="mb-3 flex gap-2" role="tablist">
            {(['media', 'images'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className="rounded-full px-3 py-1 text-xs"
                style={{ background: tab === t ? 'var(--active)' : undefined }}
                onClick={() => setTab(t)}
              >
                {t === 'media' ? 'Video & audio' : `Images${images ? ` (${images.total})` : ''}`}
              </button>
            ))}
          </div>

          {tab === 'media' && (
            <>
              {probing && <p style={{ color: 'var(--muted)', fontSize: 12 }}>Looking up this page with yt-dlp…</p>}
              {!probe && !probing && info.ytdlp.present && !blocked && (
                <div className="mb-3">
                  {probeError && <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>{hasMedia ? 'yt-dlp does not support this page directly. ' : 'No downloadable video or audio was found on this page. '}{probeError}</p>}
                  {!hasMedia && !probeError && <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>No video or audio was detected on this page.</p>}
                  <button className="rounded-full px-4 py-2" style={{ border: '1px solid var(--border)' }} onClick={() => runProbe(info.url)}>
                    Check this page with yt-dlp
                  </button>
                </div>
              )}

              {probe && (
                <div className="mb-3 rounded-xl p-3" style={{ background: 'var(--field)' }}>
                  <div className="truncate" style={{ fontWeight: 600 }} title={probe.title}>
                    {probe.title}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {[probe.uploader, dur(probe.duration), probe.extractor].filter(Boolean).join(' · ')}
                  </div>

                  <div className="mt-3 flex gap-4" role="radiogroup">
                    {(['video', 'audio'] as const).map((m) => (
                      <label key={m} className="flex items-center gap-1.5">
                        <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                        {m === 'video' ? 'Video' : 'Audio only'}
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {mode === 'video' ? (
                      <>
                        <label className="text-xs" style={{ color: 'var(--muted)' }}>
                          Quality
                          <select
                            aria-label="Quality"
                            className="mt-1 w-full rounded-md px-2 py-1.5"
                            style={field}
                            value={height ?? ''}
                            onChange={(e) => setHeight(e.target.value ? Number(e.target.value) : null)}
                          >
                            <option value="">Best available</option>
                            {heights.map((h) => (
                              <option key={h} value={h}>
                                {qualityLabel(h)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs" style={{ color: 'var(--muted)' }}>
                          Format
                          <select aria-label="Format" className="mt-1 w-full rounded-md px-2 py-1.5" style={field} value={container} onChange={(e) => setContainer(e.target.value as Container)}>
                            <option value="mp4">MP4</option>
                            <option value="webm">WEBM</option>
                          </select>
                        </label>
                      </>
                    ) : (
                      <label className="col-span-2 text-xs" style={{ color: 'var(--muted)' }}>
                        Audio format
                        <select aria-label="Audio format" className="mt-1 w-full rounded-md px-2 py-1.5" style={field} value={audioFormat} onChange={(e) => setAudioFormat(e.target.value as AudioFormat)}>
                          <option value="mp3">MP3</option>
                          <option value="m4a">M4A</option>
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="mt-3 flex flex-col gap-1.5">
                    {mode === 'video' && probe.subtitles.length > 0 && (
                      <>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} />
                          Download subtitles
                        </label>
                        {subs && (
                          <div className="ml-6 flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-xs">
                            {probe.subtitles.slice(0, 24).map((s) => (
                              <label key={s.code} className="flex items-center gap-1" title={s.name}>
                                <input
                                  type="checkbox"
                                  checked={subLangs.includes(s.code)}
                                  onChange={(e) => setSubLangs(e.target.checked ? [...subLangs, s.code] : subLangs.filter((c) => c !== s.code))}
                                />
                                {s.code}
                                {s.auto ? ' (auto)' : ''}
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={thumb} onChange={(e) => setThumb(e.target.checked)} />
                      Also save the thumbnail (maximum resolution)
                    </label>
                    {probe.isPlaylist && (
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={playlist} onChange={(e) => setPlaylist(e.target.checked)} />
                        Download the whole playlist ({probe.playlistCount} videos)
                      </label>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button className="rounded-full px-4 py-2" style={primary} disabled={blocked} onClick={() => void start('video')}>
                      Download
                    </button>
                    <button className="rounded-full px-4 py-2" style={{ border: '1px solid var(--border)' }} disabled={blocked} onClick={() => void start('thumbnail')}>
                      Thumbnail only
                    </button>
                  </div>
                </div>
              )}

              {info.sniffed.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold">Found on this page</div>
                  <ul>
                    {info.sniffed.slice(0, 12).map((m) => (
                      <li key={m.url} className="flex items-center gap-2" style={{ minHeight: 32 }}>
                        <span className="shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase" style={{ background: 'var(--active)' }}>
                          {KIND_LABEL[m.kind]}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs" title={m.url}>
                          {trimUrl(m.url)}
                          {m.size ? ` · ${formatBytes(m.size)}` : ''}
                        </span>
                        <button className="shrink-0 rounded-full px-3 py-1 text-xs" style={{ border: '1px solid var(--border)' }} disabled={blocked} onClick={() => void startSniffed(m)}>
                          Download
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {tab === 'images' && (
            <div>
              {!images || images.total === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: 12 }}>No images found on this page.</p>
              ) : (
                <>
                  <label className="text-xs" style={{ color: 'var(--muted)' }}>
                    Only images at least this wide
                    <select aria-label="Minimum image width" className="mt-1 w-full rounded-md px-2 py-1.5" style={field} value={minWidth} onChange={(e) => setMinWidth(Number(e.target.value))}>
                      {IMAGE_THRESHOLDS.map((t) => (
                        <option key={t} value={t}>
                          {t === 0 ? 'Any size' : `${t}px or wider`} ({images.byMinWidth[String(t)] ?? 0})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="mt-3 rounded-full px-4 py-2 disabled:opacity-40"
                    style={primary}
                    disabled={blocked || (images.byMinWidth[String(minWidth)] ?? 0) === 0}
                    onClick={async () => {
                      const r = await window.bmax.cmd('media.saveImages', { minWidth })
                      setMsg(r.id ? 'Saving images… see Downloads (Ctrl+J).' : 'No images matched.')
                    }}
                  >
                    Save {images.byMinWidth[String(minWidth)] ?? 0} images
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {msg && <p style={{ color: 'var(--ok)', fontSize: 12, marginTop: 10 }}>{msg}</p>}
      {info.viaTor && <p style={{ color: 'var(--muted)', fontSize: 11, marginTop: 8 }}>Downloads from this window are routed through Tor.</p>}
    </div>
  )
}
