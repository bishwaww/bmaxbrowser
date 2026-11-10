/** Reader mode: data handed from main (extracted with Readability) to the reader page. HTML is UNTRUSTED until sanitized. */
export interface Article {
  title: string
  byline: string
  siteName: string
  excerpt: string
  /** Original page address. */
  url: string
  /** Readability's content HTML. Untrusted: the reader page sanitizes it with an allow-list before display. */
  html: string
  lang: string
  dir: 'ltr' | 'rtl' | ''
  /** Approximate word count. */
  words: number
}

/** Estimated reading time in minutes (200 wpm, at least 1). */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 200))
}

export const READER_MAX_HTML = 4_000_000
