import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

export interface TestServer {
  port: number
  /** http://127.0.0.1:PORT (local: never upgraded to HTTPS) */
  origin: string
  /** http://localhost:PORT */
  alt: string
  /** http://a.example:PORT — resolves to 127.0.0.1 via --host-resolver-rules; NOT local, so HTTPS-Only applies. */
  a: string
  /** http://b.example:PORT — a different site than `a`. */
  b: string
  beacons(): number
  close(): Promise<void>
}

/** Tiny local web server so e2e tests never depend on the internet. */
export async function startServer(): Promise<TestServer> {
  let port = 0
  let beacons = 0
  const b = (): string => `http://b.example:${port}`
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const send = (body: string, type = 'text/html; charset=utf-8', headers: Record<string, string | string[]> = {}): void => {
      res.writeHead(200, { 'content-type': type, ...headers })
      res.end(body)
    }
    switch (url.pathname) {
      case '/':
        return send(`<!doctype html><title>Home Page</title><link rel="icon" href="/favicon.png">
          <body><h1>Home</h1><p>hello world foo foo</p>
          <a id="l" href="/b">to b</a> <a id="blank" target="_blank" href="/b">blank</a>
          <a id="mail" href="mailto:test@example.com">mail</a>
          <iframe id="f" src="/frame"></iframe></body>`)
      case '/b':
        return send('<!doctype html><title>Page B</title><body>page b</body>')
      case '/frame':
        return send('<!doctype html><title>Frame</title><body>frame</body>')
      case '/perm':
        return send('<!doctype html><title>Perm</title><body><script>window.__perm = "pending"; Notification.requestPermission().then(p => { window.__perm = p })</script></body>')
      case '/favicon.png':
        res.writeHead(200, { 'content-type': 'image/png' })
        return void res.end(PNG)
      case '/headers':
        return send(JSON.stringify(req.headers), 'application/json')
      case '/setcookie':
        return send("<!doctype html><title>Cookie set</title><body><script>document.cookie = 'js=1; path=/'</script>set</body>", 'text/html; charset=utf-8', {
          'set-cookie': 'tp=1; Path=/'
        })
      case '/setcookie-img':
        res.writeHead(200, { 'content-type': 'image/png', 'set-cookie': 'img=1; Path=/' })
        return void res.end(PNG)
      case '/echo':
        return send(req.headers.cookie ?? '', 'text/plain')
      case '/embed':
        return send(`<!doctype html><title>Embed</title><body><iframe id="f" src="${b()}/setcookie"></iframe><img src="${b()}/setcookie-img"></body>`)
      case '/ref':
        return send(`<!doctype html><title>Ref</title><body><a id="x" href="${b()}/headers">go</a></body>`)
      case '/beacon':
        beacons++
        res.writeHead(204)
        return void res.end()
      case '/count':
        return send(String(beacons), 'text/plain')
      default:
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('nope')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    alt: `http://localhost:${port}`,
    a: `http://a.example:${port}`,
    b: b(),
    beacons: () => beacons,
    close: () => new Promise((r) => server.close(() => r()))
  }
}
