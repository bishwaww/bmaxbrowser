import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

export interface TestServer {
  port: number
  origin: string
  alt: string
  close(): Promise<void>
}

/** Tiny local web server so e2e tests never depend on the internet. */
export async function startServer(): Promise<TestServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const send = (body: string, type = 'text/html; charset=utf-8'): void => {
      res.writeHead(200, { 'content-type': type })
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
      default:
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('nope')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    alt: `http://localhost:${port}`,
    close: () => new Promise((r) => server.close(() => r()))
  }
}
