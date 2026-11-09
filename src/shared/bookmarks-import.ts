export interface ImportedBookmark {
  title: string
  url: string
  folder: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&amp;/gi, '&')
}

/**
 * Parse a Netscape-format bookmarks file (what Chrome, Firefox and Edge export as "bookmarks.html").
 * Only http(s) links are kept; folders become a "A / B" path. Pure function, tolerant of malformed input.
 */
export function parseBookmarksHtml(html: string, limit = 20000): ImportedBookmark[] {
  const out: ImportedBookmark[] = []
  const stack: string[] = []
  let pendingFolder: string | null = null
  const token = /<H3[^>]*>([\s\S]*?)<\/H3>|<DL[^>]*>|<\/DL>|<A\s+([^>]*)>([\s\S]*?)<\/A>/gi
  let m: RegExpExecArray | null
  while ((m = token.exec(html)) && out.length < limit) {
    const whole = m[0].toUpperCase()
    if (whole.startsWith('<H3')) {
      pendingFolder = decodeEntities((m[1] ?? '').replace(/<[^>]*>/g, '').trim())
    } else if (whole.startsWith('<DL')) {
      stack.push(pendingFolder ?? '')
      pendingFolder = null
    } else if (whole.startsWith('</DL')) {
      stack.pop()
    } else {
      const href = /HREF\s*=\s*"([^"]*)"/i.exec(m[2] ?? '')?.[1]
      if (!href) continue
      const url = decodeEntities(href).trim()
      if (!/^https?:\/\//i.test(url) || url.length > 2048) continue
      try {
        new URL(url)
      } catch {
        continue
      }
      const title = decodeEntities((m[3] ?? '').replace(/<[^>]*>/g, '').trim()).slice(0, 200) || url
      out.push({ title, url, folder: stack.filter(Boolean).join(' / ') })
    }
  }
  return out
}
