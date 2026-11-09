import { app } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'
import type { TorState } from '@shared/types'
import { resourcePath } from '../app/paths'

const BOOTSTRAP_RE = /Bootstrapped (\d+)%(?: \(([^)]*)\))?: (.*)/

/** Remove state directories left behind by a previous run that was killed (their owner pid is gone). */
function sweepStaleDirs(): void {
  try {
    const tmp = app.getPath('temp')
    for (const name of readdirSync(tmp)) {
      const m = /^bmax-tor-(\d+)-/.exec(name)
      if (!m || Number(m[1]) === process.pid) continue
      try {
        process.kill(Number(m[1]), 0)
        continue // owner still running
      } catch {
        /* owner is gone */
      }
      rmSync(join(tmp, name), { recursive: true, force: true })
    }
  } catch {
    /* best effort */
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

/** Official Tor expert bundle, extracted as-is: resources/bin/tor/<platform>-<arch>/{tor/tor(.exe), data/geoip*} */
export function torBinaryPath(): string | null {
  const exe = process.platform === 'win32' ? 'tor.exe' : 'tor'
  const p = resourcePath('bin', 'tor', `${process.platform}-${process.arch}`, 'tor', exe)
  return existsSync(p) ? p : null
}

/**
 * Runs the bundled Tor binary as a client-only SOCKS5 proxy on loopback.
 * - Launched with an argument array (never a shell string).
 * - Tor's state lives in a temp directory that is deleted when Tor stops.
 * - Until bootstrap reaches 100% `isReady()` is false and every Tor window blocks all web requests (fail closed).
 */
export class TorManager extends EventEmitter {
  private proc: ChildProcess | null = null
  private current: TorState = { status: 'stopped', progress: 0, summary: 'Tor is not running' }
  private socks = 0
  private control = 0
  private dir = ''
  private startPromise: Promise<void> | null = null

  /** The SOCKS port Tor listens on (0 until reserved). */
  socksPort(): number {
    return this.socks
  }
  isReady(): boolean {
    return this.current.status === 'ready'
  }
  state(): TorState {
    return { ...this.current }
  }
  /** The SOCKS port Tor windows proxy through. Reserved up front so proxies are configured before Tor is up. */
  async reservePort(): Promise<number> {
    if (!this.socks) this.socks = await freePort()
    return this.socks
  }

  private set(next: Partial<TorState>): void {
    this.current = { ...this.current, ...next }
    this.emit('state', this.state())
  }

  /** Start Tor (idempotent). Resolves when bootstrap finishes or fails; never rejects. */
  start(): Promise<void> {
    if (this.current.status === 'ready' || this.current.status === 'starting') return this.startPromise ?? Promise.resolve()
    this.startPromise = this.doStart().catch((err) => {
      this.set({ status: 'failed', summary: 'Could not start Tor', error: String(err instanceof Error ? err.message : err) })
    })
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    const fake = process.env['BMAX_TEST'] === '1' ? process.env['BMAX_TOR_FAKE'] : undefined
    const noBin = process.env['BMAX_TEST'] === '1' && process.env['BMAX_TOR_NOBIN'] === '1' // test hook: simulate a missing binary
    const bin = fake ? process.execPath : noBin ? null : torBinaryPath()
    if (!bin) {
      this.set({
        status: 'missing',
        progress: 0,
        summary: 'The Tor program is not installed',
        error: 'Tor was not found in resources/bin/tor. Install the official Tor expert bundle (see docs/BINARIES.md).'
      })
      return
    }
    sweepStaleDirs()
    await this.reservePort()
    this.control = await freePort()
    this.dir = join(app.getPath('temp'), `bmax-tor-${process.pid}-${Date.now().toString(36)}`)
    mkdirSync(join(this.dir, 'data'), { recursive: true })
    this.set({ status: 'starting', progress: 0, summary: 'Starting Tor…', error: undefined })

    const geo = fake ? [] : this.geoipArgs(bin)
    const torArgs = [
      '--DataDirectory', join(this.dir, 'data'),
      '--SocksPort', `127.0.0.1:${this.socks}`,
      '--ControlPort', `127.0.0.1:${this.control}`,
      '--CookieAuthentication', '1',
      '--CookieAuthFile', join(this.dir, 'control_auth_cookie'),
      '--ClientOnly', '1',
      '--SafeSocks', '1',
      '--AvoidDiskWrites', '1',
      '--Log', 'notice stdout',
      ...geo
    ]
    const args = fake ? [fake, ...torArgs] : torArgs
    const env = fake ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : { ...process.env }
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
    this.proc = proc

    await new Promise<void>((resolve) => {
      let buf = ''
      const onData = (chunk: Buffer): void => {
        buf += chunk.toString('utf8')
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          const m = BOOTSTRAP_RE.exec(line)
          if (m) {
            const progress = Number(m[1])
            if (progress >= 100) {
              this.set({ status: 'ready', progress: 100, summary: 'Connected to the Tor network' })
              resolve()
            } else {
              this.set({ status: 'starting', progress, summary: m[3] ?? 'Connecting…' })
            }
          } else if (/\[err\]/i.test(line)) {
            this.set({ error: line.replace(/^.*\[err\]\s*/i, '').slice(0, 300) })
          }
        }
      }
      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)
      proc.once('error', (err) => {
        this.set({ status: 'failed', summary: 'Could not start Tor', error: err.message })
        resolve()
      })
      proc.once('exit', (code) => {
        if (this.proc === proc) this.proc = null
        if (this.current.status !== 'stopped') {
          this.set({ status: 'failed', progress: 0, summary: 'Tor stopped unexpectedly', error: `exit code ${code}` })
        }
        resolve()
      })
    })
  }

  private geoipArgs(bin: string): string[] {
    const data = join(bin, '..', '..', 'data')
    const out: string[] = []
    if (existsSync(join(data, 'geoip'))) out.push('--GeoIPFile', join(data, 'geoip'))
    if (existsSync(join(data, 'geoip6'))) out.push('--GeoIPv6File', join(data, 'geoip6'))
    return out
  }

  /** Ask Tor for fresh circuits (SIGNAL NEWNYM) over the control port using cookie authentication. */
  async newCircuit(): Promise<boolean> {
    if (!this.isReady() || !this.control) return false
    try {
      const cookie = readFileSync(join(this.dir, 'control_auth_cookie')).toString('hex')
      const replies = await this.controlExchange([`AUTHENTICATE ${cookie}`, 'SIGNAL NEWNYM', 'QUIT'])
      return replies[0]?.startsWith('250') === true && replies[1]?.startsWith('250') === true
    } catch {
      return false
    }
  }

  private controlExchange(commands: string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const sock = connect(this.control, '127.0.0.1')
      const replies: string[] = []
      let buf = ''
      let sent = 0
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error('control port timeout'))
      }, 8000)
      sock.setEncoding('utf8')
      sock.on('connect', () => sock.write(`${commands[sent++]}\r\n`))
      sock.on('data', (d: string) => {
        buf += d
        let nl: number
        while ((nl = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 2)
          if (/^\d{3} /.test(line)) {
            replies.push(line)
            if (sent < commands.length) sock.write(`${commands[sent++]}\r\n`)
            else {
              clearTimeout(timer)
              sock.end()
              resolve(replies)
            }
          }
        }
      })
      sock.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      sock.on('close', () => {
        clearTimeout(timer)
        resolve(replies)
      })
    })
  }

  /** App is quitting: kill Tor and delete its state directory right now (no timers survive a quit). */
  shutdown(): void {
    const dir = this.dir
    this.stop()
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      } catch {
        /* swept on the next start */
      }
    }
  }

  stop(): void {
    const proc = this.proc
    this.proc = null
    this.startPromise = null
    this.set({ status: 'stopped', progress: 0, summary: 'Tor is not running', error: undefined })
    if (proc && !proc.killed) proc.kill()
    if (this.dir) {
      const dir = this.dir
      this.dir = ''
      // Give Tor a moment to release files, then remove its state directory.
      setTimeout(() => {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
      }, 1500).unref()
    }
  }
}
