/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * YouTube ad removal — a SEPARATE, self-contained module so it can be updated quickly when YouTube changes.
 *
 * `injectYoutube` is stringified and run in the page's MAIN world at document start (see preload/web.ts), only on YouTube hosts
 * and only when Shields is on for the site. It does three things, none of which need network-level body rewriting
 * (Electron's webRequest cannot rewrite response bodies):
 *   1. strips ad fields out of YouTube's player/feed JSON as it is parsed (JSON.parse, Response.json, ytInitialPlayerResponse, ytInitialData),
 *   2. auto-skips any ad that still reaches the player (clicks Skip, fast-forwards the ad video, restores sound/speed afterwards),
 *   3. (CSS hiding of ad containers is applied from the main process, see main/shields/youtube/index.ts).
 *
 * To update when YouTube changes: edit AD_KEYS / AD_RENDERERS / SKIP_SELECTORS below (and the matching unit test).
 * It must stay free of imports and closures.
 */
export interface YoutubeConfig {
  enabled: boolean
}

export function injectYoutube(cfg: YoutubeConfig): void {
  if (!cfg.enabled) return
  const g = globalThis as any

  /** Keys on the player response that carry ads. */
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']
  /** Feed/watch-next renderers that are ads or promotions; list items containing them are dropped. */
  const AD_RENDERERS = [
    'adSlotRenderer',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer',
    'displayAdRenderer',
    'adPlacementRenderer',
    'compactPromotedVideoRenderer',
    'promotedVideoRenderer',
    'bannerPromoRenderer',
    'statementBannerRenderer',
    'searchPyvRenderer',
    'inFeedAdLayoutRenderer',
    'videoMastheadAdV3Renderer',
    'brandVideoShelfRenderer',
    'brandVideoSingletonRenderer',
    'playerLegacyDesktopWatchAdsRenderer'
  ]
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-overlay-close-button'
  ]
  const RESPONSE_URL = /\/youtubei\/v1\/(player|next|browse|search|reel|get_watch|guide)/

  function hasAdRenderer(node: any, depth: number): boolean {
    if (!node || typeof node !== 'object' || depth < 0) return false
    for (const k of Object.keys(node)) {
      if (AD_RENDERERS.indexOf(k) !== -1) return true
      if (depth > 0 && hasAdRenderer(node[k], depth - 1)) return true
    }
    return false
  }

  let removed = 0
  try {
    // Diagnostics for tests/support: how many ad items this module removed on this page.
    Object.defineProperty(g, '__bmaxYoutubeRemoved', { get: () => removed, configurable: true, enumerable: false })
  } catch {
    /* ignore */
  }

  /** Remove ad data in place. Returns the same object. */
  function prune(obj: any, depth: number): any {
    if (!obj || typeof obj !== 'object' || depth > 14) return obj
    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (hasAdRenderer(obj[i], 3)) {
          obj.splice(i, 1)
          removed++
        }
        else prune(obj[i], depth + 1)
      }
      return obj
    }
    for (const k of AD_KEYS) {
      if (k in obj) {
        delete obj[k]
        removed++
      }
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (v && typeof v === 'object') prune(v, depth + 1)
    }
    return obj
  }

  const looksLikeYoutube = (o: any): boolean =>
    !!o && typeof o === 'object' && ('responseContext' in o || 'playerResponse' in o || 'playabilityStatus' in o)

  // ---- 1a. JSON.parse (covers XHR/fetch consumers that parse text themselves)
  try {
    const origParse = JSON.parse
    JSON.parse = function (this: unknown, ...args: [string, ((k: string, v: any) => any)?]) {
      const out = origParse.apply(this, args as any)
      try {
        if (looksLikeYoutube(out)) prune(out, 0)
      } catch {
        /* never break the page */
      }
      return out
    } as typeof JSON.parse
  } catch {
    /* ignore */
  }

  // ---- 1b. fetch().json()
  try {
    if (g.Response && g.Response.prototype && g.Response.prototype.json) {
      const origJson = g.Response.prototype.json
      g.Response.prototype.json = function (this: any) {
        const p = origJson.call(this)
        const url: string = this && this.url ? String(this.url) : ''
        return RESPONSE_URL.test(url)
          ? p.then((o: any) => {
              try {
                return prune(o, 0)
              } catch {
                return o
              }
            })
          : p
      }
    }
  } catch {
    /* ignore */
  }

  // ---- 1c. initial page data
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    try {
      let value: any = g[name]
      Object.defineProperty(g, name, {
        configurable: true,
        enumerable: true,
        get() {
          return value
        },
        set(v: any) {
          try {
            value = prune(v, 0)
          } catch {
            value = v
          }
        }
      })
    } catch {
      /* ignore */
    }
  }

  // ---- 2. auto-skip whatever still gets through
  let saved: { muted: boolean; rate: number } | null = null
  function tick(): void {
    const doc = g.document
    if (!doc || !doc.querySelector) return
    const player = doc.querySelector('.html5-video-player')
    const adShowing = !!player && player.classList.contains('ad-showing')
    const video = player ? player.querySelector('video') : null
    if (adShowing && video) {
      if (!saved) saved = { muted: video.muted, rate: video.playbackRate }
      try {
        video.muted = true
        video.playbackRate = 16
        if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.2) video.currentTime = video.duration - 0.1
      } catch {
        /* ignore */
      }
    } else if (saved && video) {
      video.muted = saved.muted
      video.playbackRate = saved.rate
      saved = null
    }
    for (const sel of SKIP_SELECTORS) {
      const btn = doc.querySelector(sel)
      if (btn && typeof btn.click === 'function') btn.click()
    }
  }
  try {
    g.setInterval(tick, 250)
    if (g.MutationObserver && g.document) {
      new g.MutationObserver(tick).observe(g.document, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true })
    }
  } catch {
    /* ignore */
  }
}
