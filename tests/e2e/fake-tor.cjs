/* Fake "tor" used by e2e tests (run through Electron-as-node). Mimics what BMAX needs from Tor:
 *  - prints "Bootstrapped N%" lines on stdout (slowly, so tests can observe the not-yet-connected window)
 *  - a SOCKS5 listener that records the *hostname* each client asked for (proves remote DNS) and pipes to a local test server
 *  - a control port that accepts cookie authentication and SIGNAL NEWNYM
 * Environment: FAKE_TOR_TARGET (port of the local test server), FAKE_TOR_LOG (file to append events to), FAKE_TOR_STEP_MS
 */
const net = require('node:net')
const fs = require('node:fs')

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const socksPort = Number((arg('--SocksPort') || '').split(':').pop())
const controlPort = Number((arg('--ControlPort') || '').split(':').pop())
const cookieFile = arg('--CookieAuthFile')
const target = Number(process.env.FAKE_TOR_TARGET)
const logFile = process.env.FAKE_TOR_LOG
const step = Number(process.env.FAKE_TOR_STEP_MS || 700)
const log = (line) => {
  if (logFile) fs.appendFileSync(logFile, line + '\n')
}

const cookie = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255))
if (cookieFile) fs.writeFileSync(cookieFile, cookie)

// ---- SOCKS5
net
  .createServer((client) => {
    let stage = 0
    let buf = Buffer.alloc(0)
    client.on('error', () => {})
    client.on('data', (chunk) => {
      if (stage === 2) return
      buf = Buffer.concat([buf, chunk])
      if (stage === 0 && buf.length >= 2 && buf.length >= 2 + buf[1]) {
        client.write(Buffer.from([5, 0]))
        buf = buf.subarray(2 + buf[1])
        stage = 1
      }
      if (stage === 1 && buf.length >= 5) {
        const atyp = buf[3]
        let host
        let off
        if (atyp === 3) {
          const len = buf[4]
          if (buf.length < 5 + len + 2) return
          host = buf.subarray(5, 5 + len).toString()
          off = 5 + len
        } else if (atyp === 1) {
          if (buf.length < 10) return
          host = Array.from(buf.subarray(4, 8)).join('.')
          off = 8
        } else {
          client.destroy()
          return
        }
        const port = buf.readUInt16BE(off)
        const rest = buf.subarray(off + 2)
        stage = 2
        log(`SOCKS ${atyp === 3 ? 'DOMAIN' : 'IP'} ${host}:${port}`)
        const upstream = net.connect(target, '127.0.0.1', () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          if (rest.length) upstream.write(rest)
          client.pipe(upstream)
          upstream.pipe(client)
        })
        upstream.on('error', () => client.destroy())
        client.on('close', () => upstream.destroy())
      }
    })
  })
  .listen(socksPort, '127.0.0.1')

// ---- control port
net
  .createServer((sock) => {
    let authed = false
    let buf = ''
    sock.on('error', () => {})
    sock.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (line.startsWith('AUTHENTICATE ')) {
          authed = line.slice(13).trim() === cookie.toString('hex')
          sock.write(authed ? '250 OK\r\n' : '515 Authentication failed\r\n')
        } else if (line === 'SIGNAL NEWNYM' && authed) {
          log('NEWNYM')
          sock.write('250 OK\r\n')
        } else if (line === 'QUIT') {
          sock.write('250 closing connection\r\n')
          sock.end()
        } else sock.write('510 Unrecognized command\r\n')
      }
    })
  })
  .listen(controlPort, '127.0.0.1')

// ---- bootstrap progress
const lines = [
  [5, 'conn_pt', 'Connecting to pluggable transport'],
  [40, 'loading_descriptors', 'Loading relay descriptors'],
  [90, 'ap_conn', 'Connecting to a relay to build circuits'],
  [100, 'done', 'Done']
]
let t = step
for (const [pct, tag, summary] of lines) {
  setTimeout(() => {
    log(`BOOT ${pct}`)
    process.stdout.write(`Nov 09 12:00:00.000 [notice] Bootstrapped ${pct}% (${tag}): ${summary}\n`)
  }, t)
  t += step
}
process.on('SIGTERM', () => {
  log('EXIT')
  process.exit(0)
})
process.on('exit', () => log('EXIT'))
