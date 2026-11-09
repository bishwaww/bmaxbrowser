import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { injectYoutube } from '../../src/preload/youtube'
import { isYoutubeHost, YOUTUBE_CSS } from '../../src/main/shields/youtube'

/** Run the injected script in a bare context that has just enough browser API to load it. */
function load(): { run: (code: string) => unknown } {
  const ctx = createContext({
    console,
    Response: class {
      url = ''
      json(): Promise<unknown> {
        return Promise.resolve({})
      }
    },
    setInterval: () => 0,
    document: { querySelector: () => null }
  })
  runInContext('globalThis.window = globalThis', ctx)
  runInContext(`(${injectYoutube.toString()})({ enabled: true })`, ctx)
  return { run: (code) => runInContext(code, ctx) }
}

describe('YouTube ad pruning (injected script)', () => {
  it('removes ad fields from player responses parsed with JSON.parse, keeps the rest', () => {
    const { run } = load()
    const out = run(`JSON.stringify(JSON.parse(JSON.stringify({
      responseContext: {}, playabilityStatus: { status: 'OK' },
      adPlacements: [{ x: 1 }], playerAds: [{ y: 2 }], adSlots: [{ z: 3 }],
      streamingData: { formats: [{ itag: 18 }] }, videoDetails: { videoId: 'abc' }
    })))`) as string
    const obj = JSON.parse(out) as Record<string, unknown>
    expect(obj['adPlacements']).toBeUndefined()
    expect(obj['playerAds']).toBeUndefined()
    expect(obj['adSlots']).toBeUndefined()
    expect(obj['streamingData']).toEqual({ formats: [{ itag: 18 }] })
    expect(obj['videoDetails']).toEqual({ videoId: 'abc' })
  })

  it('prunes nested playerResponse ads (e.g. /next and watch-page payloads)', () => {
    const { run } = load()
    const out = run(`JSON.stringify(JSON.parse(JSON.stringify({ responseContext: {}, playerResponse: { adPlacements: [1], videoDetails: { videoId: 'x' } } })))`) as string
    expect(JSON.parse(out)).toEqual({ responseContext: {}, playerResponse: { videoDetails: { videoId: 'x' } } })
  })

  it('drops ad items from feed lists but keeps real videos', () => {
    const { run } = load()
    const out = run(`JSON.stringify(JSON.parse(JSON.stringify({ responseContext: {}, contents: [
      { richItemRenderer: { content: { adSlotRenderer: { a: 1 } } } },
      { richItemRenderer: { content: { videoRenderer: { videoId: 'keep1' } } } },
      { promotedSparklesWebRenderer: {} },
      { richItemRenderer: { content: { videoRenderer: { videoId: 'keep2' } } } }
    ] })))`) as string
    const ids = (JSON.parse(out) as { contents: { richItemRenderer: { content: { videoRenderer: { videoId: string } } } }[] }).contents.map(
      (c) => c.richItemRenderer.content.videoRenderer.videoId
    )
    expect(ids).toEqual(['keep1', 'keep2'])
  })

  it('prunes ytInitialPlayerResponse as the page assigns it', () => {
    const { run } = load()
    run(`ytInitialPlayerResponse = { playabilityStatus: {}, adPlacements: [1], playerAds: [2], videoDetails: { videoId: 'v' } }`)
    expect(run(`JSON.stringify(ytInitialPlayerResponse)`)).toBe('{"playabilityStatus":{},"videoDetails":{"videoId":"v"}}')
  })

  it('leaves unrelated JSON untouched', () => {
    const { run } = load()
    expect(run(`JSON.stringify(JSON.parse('{"adPlacements":"not youtube","a":[1,2,3]}'))`)).toBe('{"adPlacements":"not youtube","a":[1,2,3]}')
    expect(run(`JSON.parse('[1,2,{"a":3}]').length`)).toBe(3)
  })

  it('does nothing when disabled', () => {
    const ctx = createContext({ document: { querySelector: () => null }, setInterval: () => 0 })
    runInContext(`(${injectYoutube.toString()})({ enabled: false })`, ctx)
    expect(runInContext(`JSON.stringify(JSON.parse('{"responseContext":{},"adPlacements":[1]}'))`, ctx)).toBe('{"responseContext":{},"adPlacements":[1]}')
  })
})

describe('YouTube host matching and CSS', () => {
  it('matches YouTube domains only', () => {
    for (const h of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com', 'youtu.be']) expect(isYoutubeHost(h), h).toBe(true)
    for (const h of ['notyoutube.com', 'youtube.com.evil.example', 'example.com']) expect(isYoutubeHost(h), h).toBe(false)
  })
  it('hides ad containers but never the player itself', () => {
    expect(YOUTUBE_CSS).toContain('ytd-ad-slot-renderer')
    expect(YOUTUBE_CSS).toContain('#masthead-ad')
    expect(YOUTUBE_CSS).not.toMatch(/(^|,)\s*(\.html5-video-player|video|#movie_player)\s*(,|\{)/)
  })
})
