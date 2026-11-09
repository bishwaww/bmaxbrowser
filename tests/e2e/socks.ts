import { createServer, connect } from 'node:net'
import type { Server, Socket } from 'node:net'

export interface FakeSocks {
  port: number
  hosts: string[]
  close(): Promise<void>
}

/** In-process SOCKS5 proxy for the "user proxy" tests. Records requested hostnames and forwards to a local port. */
export async function startSocks(targetPort: number): Promise<FakeSocks> {
  const hosts: string[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer((client) => {
    sockets.add(client)
    client.on('close', () => sockets.delete(client))
    let buf = Buffer.alloc(0)
    let stage = 0
    client.on('error', () => undefined)
    client.on('data', (chunk) => {
      if (stage === 2) return
      buf = Buffer.concat([buf, chunk])
      if (stage === 0 && buf.length >= 2 && buf.length >= 2 + buf[1]!) {
        client.write(Buffer.from([5, 0]))
        buf = buf.subarray(2 + buf[1]!)
        stage = 1
      }
      if (stage === 1 && buf.length >= 5) {
        const atyp = buf[3]
        let host: string
        let off: number
        if (atyp === 3) {
          const len = buf[4]!
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
        const rest = buf.subarray(off + 2)
        stage = 2
        hosts.push(host)
        const up = connect(targetPort, '127.0.0.1', () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          if (rest.length) up.write(rest)
          client.pipe(up)
          up.pipe(client)
        })
        up.on('error', () => client.destroy())
        client.on('close', () => up.destroy())
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  return {
    port,
    hosts,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      })
  }
}
