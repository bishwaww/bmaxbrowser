/**
 * YouTube module (main-process side). Everything YouTube-specific that lives in the main process is here;
 * the in-page logic is src/preload/youtube.ts. Network-level blocking of YouTube ads comes from the uBlock Origin
 * "quick fixes" / filter lists (with their scriptlets), which are enabled by default.
 */
const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtu\.be)$/i

/** Test hook: real YouTube hosts are HSTS-preloaded, so e2e tests use a stand-in host name. */
const TEST_HOST = process.env['BMAX_TEST'] === '1' ? process.env['BMAX_TEST_YT_HOST'] : undefined

export function isYoutubeHost(hostname: string): boolean {
  return YT_HOST.test(hostname) || (TEST_HOST !== undefined && hostname === TEST_HOST)
}

/** Hide ad containers (applied with insertCSS, which is not subject to the page's CSP). */
export const YOUTUBE_CSS = [
  '#masthead-ad',
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-banner-promo-renderer',
  'ytd-statement-banner-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-display-ad-renderer',
  'ytd-companion-slot-renderer',
  'ytd-action-companion-ad-renderer',
  '#player-ads',
  '.ytp-ad-overlay-slot',
  '.ytp-ad-overlay-container',
  '.ytp-ad-image-overlay',
  'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
  'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)'
].join(',\n') + ' { display: none !important; }'

export function youtubeEnabledFor(hostname: string, settingOn: boolean): boolean {
  return settingOn && isYoutubeHost(hostname)
}
