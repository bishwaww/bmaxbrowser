/**
 * Fingerprinting protection. `inject` is stringified and executed in the page's MAIN world at document start
 * (webFrame.executeJavaScript), in every frame. It must stay fully self-contained: no imports, no closures.
 *
 * Approach (same idea as Brave's "farbling"): a per-session, per-site seed drives tiny deterministic noise, so a site
 * sees stable values across its own pages but different values than any other site, and nothing matches a global
 * fingerprint database. Values that are rarely needed (battery, connection, high-entropy UA data) are removed/reduced.
 */
export interface WebConfig {
  fp: boolean
  seed: string
  tor: boolean
  gpc: boolean
  uniformUa: boolean
  major: number
  thirdParty: boolean
}

export function inject(cfg: WebConfig): void {
  const g = globalThis as unknown as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const nativeToString = Function.prototype.toString
  const masked = new WeakMap<object, string>()
  const maskedToString = function toString(this: unknown): string {
    const m = typeof this === 'function' || (typeof this === 'object' && this !== null) ? masked.get(this as object) : undefined
    return m ?? nativeToString.call(this)
  }
  masked.set(maskedToString, 'function toString() { [native code] }')
  try {
    Object.defineProperty(Function.prototype, 'toString', { value: maskedToString, configurable: true, writable: true })
  } catch {
    /* ignore */
  }
  function mask<T extends object>(fn: T, name: string): T {
    masked.set(fn, `function ${name}() { [native code] }`)
    return fn
  }
  function defineGetter(proto: object | undefined, prop: string, value: unknown): void {
    if (!proto) return
    try {
      const getter = mask(function () { return value } as () => unknown, `get ${prop}`)
      Object.defineProperty(proto, prop, { get: getter, set: undefined, configurable: true, enumerable: true })
    } catch {
      /* ignore */
    }
  }
  function removeProp(proto: object | undefined, prop: string): void {
    if (!proto) return
    try {
      Object.defineProperty(proto, prop, { value: undefined, configurable: true, writable: true, enumerable: false })
      delete (proto as Record<string, unknown>)[prop]
    } catch {
      /* ignore */
    }
  }

  // ---- seeded PRNG (mulberry32 over an FNV-1a hash of the seed string)
  function hash(str: string): number {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
  function rng(salt: string): () => number {
    let a = hash(cfg.seed + '|' + salt)
    return function () {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // ---- third-party frames never get a cookie jar (header stripping alone cannot stop document.cookie)
  if (cfg.thirdParty) {
    try {
      const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
      if (desc) {
        Object.defineProperty(Document.prototype, 'cookie', {
          get: mask(function () { return '' } as () => string, 'get cookie'),
          set: mask(function (_v: string) { /* dropped */ } as (v: string) => void, 'set cookie'),
          configurable: true,
          enumerable: true
        })
      }
    } catch {
      /* ignore */
    }
  }

  if (cfg.gpc || cfg.tor) defineGetter(Navigator.prototype, 'globalPrivacyControl', true)

  if (cfg.tor) {
    // No WebRTC at all in Tor windows (the network policy is also set to disable_non_proxied_udp).
    for (const n of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate']) {
      try {
        Object.defineProperty(g, n, { value: undefined, configurable: true, writable: true })
      } catch {
        /* ignore */
      }
    }
    try {
      const md = navigator.mediaDevices
      if (md) {
        md.getUserMedia = mask(function () { return Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) } as typeof md.getUserMedia, 'getUserMedia')
        md.enumerateDevices = mask(function () { return Promise.resolve([]) } as typeof md.enumerateDevices, 'enumerateDevices')
      }
    } catch {
      /* ignore */
    }
  }

  if (!cfg.fp) return

  // ---- navigator surface
  defineGetter(Navigator.prototype, 'hardwareConcurrency', 4)
  defineGetter(Navigator.prototype, 'deviceMemory', 8)
  defineGetter(Navigator.prototype, 'maxTouchPoints', 0)
  if (cfg.uniformUa) {
    defineGetter(Navigator.prototype, 'platform', 'Win32')
    defineGetter(Navigator.prototype, 'language', 'en-US')
    defineGetter(Navigator.prototype, 'languages', Object.freeze(['en-US', 'en']))
    const brands = [
      { brand: 'Chromium', version: String(cfg.major) },
      { brand: 'Not-A.Brand', version: '24' },
      { brand: 'Google Chrome', version: String(cfg.major) }
    ]
    const uaData = {
      brands,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: mask(function (hints: string[]) {
        const out: Record<string, unknown> = { brands, mobile: false, platform: 'Windows' }
        for (const h of hints || []) {
          if (h === 'architecture') out.architecture = 'x86'
          else if (h === 'bitness') out.bitness = '64'
          else if (h === 'model') out.model = ''
          else if (h === 'platformVersion') out.platformVersion = '10.0.0'
          else if (h === 'uaFullVersion') out.uaFullVersion = cfg.major + '.0.0.0'
          else if (h === 'fullVersionList') out.fullVersionList = brands.map((b) => ({ brand: b.brand, version: b.version + '.0.0.0' }))
          else if (h === 'wow64') out.wow64 = false
        }
        return Promise.resolve(out)
      } as (h: string[]) => Promise<unknown>, 'getHighEntropyValues'),
      toJSON: mask(function () { return { brands, mobile: false, platform: 'Windows' } } as () => unknown, 'toJSON')
    }
    if ('userAgentData' in navigator) defineGetter(Navigator.prototype, 'userAgentData', uaData)
  }
  removeProp(Navigator.prototype, 'getBattery')
  removeProp(Navigator.prototype, 'connection')
  removeProp(Navigator.prototype, 'mozConnection')
  removeProp(Navigator.prototype, 'webkitConnection')

  // ---- canvas: noisy copy for readback APIs
  function addNoise(data: Uint8ClampedArray | Uint8Array, salt: string): void {
    const r = rng(salt)
    for (let i = 0; i < data.length; i += 4) {
      if (r() < 0.08) {
        const c = Math.floor(r() * 3)
        data[i + c] = (data[i + c]! ^ 1) as number
      }
    }
  }
  const origGetContext = HTMLCanvasElement.prototype.getContext
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL
  const origToBlob = HTMLCanvasElement.prototype.toBlob
  const origCreateElement = Document.prototype.createElement

  function noisyCopy(canvas: HTMLCanvasElement): HTMLCanvasElement {
    if (canvas.width * canvas.height < 16 || canvas.width * canvas.height > 8_000_000) return canvas
    try {
      const copy = (origCreateElement as unknown as (this: Document, t: string) => HTMLCanvasElement).call(document, 'canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      const ctx = origGetContext.call(copy, '2d') as CanvasRenderingContext2D | null
      if (!ctx) return canvas
      ctx.drawImage(canvas, 0, 0)
      const img = origGetImageData.call(ctx, 0, 0, copy.width, copy.height)
      addNoise(img.data, 'canvas')
      ctx.putImageData(img, 0, 0)
      return copy
    } catch {
      return canvas
    }
  }
  HTMLCanvasElement.prototype.toDataURL = mask(function (this: HTMLCanvasElement, ...args: unknown[]) {
    return (origToDataURL as (...a: unknown[]) => string).apply(noisyCopy(this), args)
  } as typeof origToDataURL, 'toDataURL')
  HTMLCanvasElement.prototype.toBlob = mask(function (this: HTMLCanvasElement, ...args: unknown[]) {
    return (origToBlob as (...a: unknown[]) => void).apply(noisyCopy(this), args)
  } as typeof origToBlob, 'toBlob')
  CanvasRenderingContext2D.prototype.getImageData = mask(function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    const img = (origGetImageData as (...a: unknown[]) => ImageData).apply(this, args)
    addNoise(img.data, 'imagedata')
    return img
  } as typeof origGetImageData, 'getImageData')

  // ---- WebGL: uniform vendor/renderer + readPixels noise
  const VENDOR = 'Google Inc. (Google)'
  const RENDERER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'
  for (const Ctor of [g.WebGLRenderingContext, g.WebGL2RenderingContext]) {
    const proto = Ctor?.prototype
    if (!proto) continue
    const origGetParameter = proto.getParameter
    proto.getParameter = mask(function (this: unknown, p: number) {
      if (p === 37445) return VENDOR
      if (p === 37446) return RENDERER
      return origGetParameter.call(this, p)
    } as typeof origGetParameter, 'getParameter')
    const origReadPixels = proto.readPixels
    proto.readPixels = mask(function (this: unknown, ...args: unknown[]) {
      const out = origReadPixels.apply(this, args)
      const buf = args[6] as Uint8Array | undefined
      if (buf && buf instanceof Uint8Array) addNoise(buf, 'webgl')
      return out
    } as typeof origReadPixels, 'readPixels')
  }

  // ---- audio: tiny deterministic noise on rendered samples / analyser output
  const touched = new WeakSet<object>()
  if (g.AudioBuffer) {
    const orig = g.AudioBuffer.prototype.getChannelData
    g.AudioBuffer.prototype.getChannelData = mask(function (this: object, ch: number) {
      const data: Float32Array = orig.call(this, ch)
      const key = data as unknown as object
      if (!touched.has(key)) {
        touched.add(key)
        const r = rng('audio' + ch)
        for (let i = 0; i < data.length; i += 97) data[i] = data[i]! + (r() - 0.5) * 1e-7
      }
      return data
    } as typeof orig, 'getChannelData')
  }
  if (g.AnalyserNode) {
    const p = g.AnalyserNode.prototype
    for (const name of ['getFloatFrequencyData', 'getFloatTimeDomainData']) {
      const orig = p[name]
      if (!orig) continue
      p[name] = mask(function (this: unknown, arr: Float32Array) {
        orig.call(this, arr)
        const r = rng('analyser')
        for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! + (r() - 0.5) * 1e-4
      } as typeof orig, name)
    }
  }
}
