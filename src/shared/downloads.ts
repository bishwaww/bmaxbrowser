/** Shared downloader types and pure helpers (no Electron imports). */

export type JobKind = 'video' | 'audio' | 'file' | 'images' | 'thumbnail'
export type JobState = 'queued' | 'starting' | 'downloading' | 'processing' | 'paused' | 'done' | 'error' | 'cancelled'

export interface DownloadJob {
  id: string
  kind: JobKind
  title: string
  url: string
  state: JobState
  /** 0..1, or -1 when unknown. */
  progress: number
  /** Human-readable stage ("Video", "Audio", "Merging…"). */
  stage: string
  /** bytes per second */
  speed: number | null
  /** seconds */
  eta: number | null
  bytes: number
  total: number | null
  /** Final file (or folder for image batches). */
  file: string | null
  error?: string | undefined
  startedAt: number
  finishedAt?: number | undefined
  /** Number of files written (images, playlists). */
  fileCount: number
  viaTor: boolean
}

export type Container = 'mp4' | 'webm'
export type AudioFormat = 'mp3' | 'm4a'

export interface VideoOptions {
  mode: 'video' | 'audio'
  /** Max height in pixels; null = best available. */
  height: number | null
  container: Container
  audioFormat: AudioFormat
  subtitles: boolean
  subLangs: string[]
  thumbnail: boolean
  playlist: boolean
}

export interface SubtitleLang {
  code: string
  name: string
  auto: boolean
}

export interface ProbeResult {
  url: string
  title: string
  thumbnail: string | null
  duration: number | null
  uploader: string | null
  extractor: string
  isPlaylist: boolean
  playlistCount: number
  heights: number[]
  hasAudio: boolean
  subtitles: SubtitleLang[]
}

export type SniffedKind = 'video' | 'audio' | 'hls' | 'dash'
export interface SniffedMedia {
  url: string
  kind: SniffedKind
  mime: string
  size: number | null
}

export interface MediaSummary {
  videos: number
  audios: number
  images: number
  sniffed: number
}

export interface ToolStatus {
  present: boolean
  version: string
  /** epoch ms of the last successful yt-dlp update check */
  checkedAt?: number | undefined
}

export interface MediaPanelInfo {
  tabId: number | null
  url: string
  title: string
  supported: boolean
  viaTor: boolean
  torReady: boolean
  summary: MediaSummary
  sniffed: SniffedMedia[]
  ytdlp: ToolStatus
  ffmpeg: ToolStatus
}

export interface ImageCandidate {
  url: string
  width: number
  height: number
}

export interface ImageSummary {
  total: number
  /** counts for each min-width threshold */
  byMinWidth: Record<string, number>
}

export const IMAGE_THRESHOLDS = [0, 100, 300, 600, 1000] as const

export const QUALITY_STEPS = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144] as const

export function qualityLabel(h: number): string {
  if (h >= 4320) return '8K (4320p)'
  if (h >= 2160) return '4K (2160p)'
  if (h >= 1440) return '1440p (2K)'
  return `${h}p`
}

/** Offer the standard steps that the video actually has (plus "best"). */
export function qualityOptions(heights: number[]): number[] {
  if (heights.length === 0) return []
  const max = Math.max(...heights)
  return QUALITY_STEPS.filter((s) => s <= max || heights.some((h) => h >= s - 20 && h <= s))
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '–'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

export function formatEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return ''
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}
