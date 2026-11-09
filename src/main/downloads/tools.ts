import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolStatus } from '@shared/downloads'
import { resourcePath } from '../app/paths'
import { readJson, writeJsonAtomic } from '../settings/JsonStore'

const EXE = process.platform === 'win32' ? '.exe' : ''
const PLATFORM = `${process.platform}-${process.arch}`

export function ytdlpBundled(): string | null {
  const p = resourcePath('bin', 'yt-dlp', PLATFORM, `yt-dlp${EXE}`)
  return existsSync(p) ? p : null
}

/** yt-dlp is copied to the user data folder: the install folder may be read-only and `yt-dlp -U` replaces the file. */
export function ytdlpRuntimePath(): string {
  return join(app.getPath('userData'), 'bin', `yt-dlp${EXE}`)
}

export function ffmpegDir(): string | null {
  const dir = resourcePath('bin', 'ffmpeg', PLATFORM)
  return existsSync(join(dir, `ffmpeg${EXE}`)) ? dir : null
}

/** Environment for yt-dlp: lets it run YouTube's JS challenge solver with Electron itself acting as Node (nothing extra bundled). */
export function toolProcessEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' }
}

/** `--js-runtimes` value pointing at this app's own executable (run as Node via ELECTRON_RUN_AS_NODE). */
export function jsRuntimeSpec(): string {
  return `node:${process.execPath}`
}

export function runCapture(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const maxBytes = opts.maxBytes ?? 30 * 1024 * 1024
    const proc = spawn(bin, args, { windowsHide: true, env: toolProcessEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let size = 0
    let done = false
    const finish = (code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    }
    const timer = setTimeout(() => {
      killTree(proc.pid)
      stderr += '\n[timeout]'
      finish(null)
    }, opts.timeoutMs ?? 60_000)
    proc.stdout?.on('data', (d: Buffer) => {
      size += d.length
      if (size > maxBytes) {
        killTree(proc.pid)
        stderr += '\n[output too large]'
        return
      }
      stdout += d.toString('utf8')
    })
    proc.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 20000) stderr += d.toString('utf8')
    })
    proc.on('error', (e) => {
      stderr += String(e.message)
      finish(null)
    })
    proc.on('close', (code) => finish(code))
  })
}

/** Kill a process and its children (yt-dlp spawns ffmpeg). Uses taskkill with an argument array on Windows. */
export function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

interface ToolMeta {
  ytdlpCheckedAt?: number
}
const metaFile = (): string => join(app.getPath('userData'), 'bin', 'tools.json')
export function readToolMeta(): ToolMeta {
  return (readJson(metaFile()) as ToolMeta | undefined) ?? {}
}
export function writeToolMeta(m: ToolMeta): void {
  try {
    writeJsonAtomic(metaFile(), { ...readToolMeta(), ...m })
  } catch {
    /* best effort */
  }
}

let ensured: Promise<string | null> | null = null
let versionCache: { ytdlp?: string; ffmpeg?: string } = {}

async function versionOf(bin: string, args: string[]): Promise<string> {
  const r = await runCapture(bin, args, { timeoutMs: 20_000, maxBytes: 100_000 })
  return r.code === 0 ? (r.stdout.split(/\r?\n/)[0] ?? '').trim() : ''
}

/** Make sure a runnable yt-dlp exists in userData (copy from the bundle; replace it if the bundled one is newer). */
export function ensureYtdlp(): Promise<string | null> {
  if (ensured) return ensured
  ensured = (async () => {
    const src = ytdlpBundled()
    const dst = ytdlpRuntimePath()
    try {
      if (!src && !existsSync(dst)) return null
      mkdirSync(join(app.getPath('userData'), 'bin'), { recursive: true })
      if (src && !existsSync(dst)) copyFileSync(src, dst)
      else if (src && statSync(src).mtimeMs > statSync(dst).mtimeMs + 1000) {
        const [bundled, current] = await Promise.all([versionOf(src, ['--version']), versionOf(dst, ['--version'])])
        if (bundled && (!current || bundled > current)) copyFileSync(src, dst)
      }
      return dst
    } catch (err) {
      console.warn('[downloads] could not prepare yt-dlp', err instanceof Error ? err.message : err)
      ensured = null
      return existsSync(dst) ? dst : null
    }
  })()
  return ensured
}

export async function ytdlpStatus(): Promise<ToolStatus> {
  const bin = await ensureYtdlp()
  if (!bin) return { present: false, version: '' }
  versionCache.ytdlp ??= await versionOf(bin, ['--version'])
  return { present: !!versionCache.ytdlp, version: versionCache.ytdlp, checkedAt: readToolMeta().ytdlpCheckedAt }
}

export async function ffmpegStatus(): Promise<ToolStatus> {
  const dir = ffmpegDir()
  if (!dir) return { present: false, version: '' }
  if (!versionCache.ffmpeg) {
    const out = await versionOf(join(dir, `ffmpeg${EXE}`), ['-version'])
    versionCache.ffmpeg = out.replace(/^ffmpeg version\s+/i, '').split(' ')[0] ?? out
  }
  return { present: true, version: versionCache.ffmpeg }
}

/** Cheap presence check (no process spawn) for UI that must open instantly. */
export function toolPresence(): { ytdlp: ToolStatus; ffmpeg: ToolStatus } {
  return {
    ytdlp: { present: existsSync(ytdlpRuntimePath()) || ytdlpBundled() !== null, version: versionCache.ytdlp ?? '' },
    ffmpeg: { present: ffmpegDir() !== null, version: versionCache.ffmpeg ?? '' }
  }
}

export function resetVersionCache(): void {
  versionCache = {}
}
