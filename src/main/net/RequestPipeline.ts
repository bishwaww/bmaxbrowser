import type {
  BeforeSendResponse,
  HeadersReceivedResponse,
  OnBeforeRequestListenerDetails,
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session
} from 'electron'

export interface PipelineContext {
  /** Session partition name, e.g. 'bmax-private'. */
  partition: string
  /** Session belongs to a Tor window (strictest rules, fail closed). */
  tor: boolean
}

export type BeforeRequestResult = { cancel?: boolean; redirectURL?: string } | void
export type BeforeRequestHandler = (
  d: OnBeforeRequestListenerDetails,
  ctx: PipelineContext
) => BeforeRequestResult | Promise<BeforeRequestResult>
export type BeforeSendHeadersHandler = (
  d: OnBeforeSendHeadersListenerDetails,
  headers: Record<string, string>,
  ctx: PipelineContext
) => void | Promise<void>
export type HeadersReceivedHandler = (
  d: OnHeadersReceivedListenerDetails,
  headers: Record<string, string[]>,
  ctx: PipelineContext
) => void | Promise<void>

interface Named<T> {
  name: string
  fn: T
}

/**
 * Electron allows exactly ONE listener per webRequest event per session, so everything that wants to
 * look at requests (Tor gate, HTTPS-only, tracking-param stripping, Shields, header rewriting, media sniffing)
 * registers a named, ordered handler here instead of touching `session.webRequest` directly.
 */
export class RequestPipeline {
  private before: Named<BeforeRequestHandler>[] = []
  private sendHeaders: Named<BeforeSendHeadersHandler>[] = []
  private received: Named<HeadersReceivedHandler>[] = []

  onBeforeRequest(name: string, fn: BeforeRequestHandler): void {
    this.before.push({ name, fn })
  }
  onBeforeSendHeaders(name: string, fn: BeforeSendHeadersHandler): void {
    this.sendHeaders.push({ name, fn })
  }
  onHeadersReceived(name: string, fn: HeadersReceivedHandler): void {
    this.received.push({ name, fn })
  }

  /** Handler names in execution order (used by tests). */
  describe(): { beforeRequest: string[]; beforeSendHeaders: string[]; headersReceived: string[] } {
    return {
      beforeRequest: this.before.map((h) => h.name),
      beforeSendHeaders: this.sendHeaders.map((h) => h.name),
      headersReceived: this.received.map((h) => h.name)
    }
  }

  install(ses: Session, ctx: PipelineContext): void {
    ses.webRequest.onBeforeRequest(async (details, callback) => {
      try {
        for (const h of this.before) {
          const r = await h.fn(details, ctx)
          if (r && (r.cancel || r.redirectURL)) return callback(r)
        }
        callback({})
      } catch (err) {
        console.error('[pipeline] onBeforeRequest failed in handler; failing closed', err)
        callback({ cancel: true })
      }
    })

    ses.webRequest.onBeforeSendHeaders(async (details, callback) => {
      const headers = { ...details.requestHeaders }
      try {
        for (const h of this.sendHeaders) await h.fn(details, headers, ctx)
      } catch (err) {
        console.error('[pipeline] onBeforeSendHeaders failed', err)
      }
      const res: BeforeSendResponse = { requestHeaders: headers }
      callback(res)
    })

    ses.webRequest.onHeadersReceived(async (details, callback) => {
      const headers: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(details.responseHeaders ?? {})) headers[k] = [...v]
      try {
        for (const h of this.received) await h.fn(details, headers, ctx)
      } catch (err) {
        console.error('[pipeline] onHeadersReceived failed', err)
      }
      const res: HeadersReceivedResponse = { responseHeaders: headers }
      callback(res)
    })
  }
}
