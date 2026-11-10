/**
 * Allow-list sanitizer for reader mode. The article HTML comes from a web page (untrusted, even after Readability), so it is
 * parsed into an inert document and rebuilt element by element: unknown tags are unwrapped, dangerous ones dropped with their
 * content, and only a few attributes survive (links and images get checked URLs). No class, id, style or event attribute is
 * ever copied. Nothing is assigned through innerHTML.
 */
const ALLOWED = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's',
  'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul'
])

/** Dropped together with everything inside them. */
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'svg',
  'math', 'noscript', 'template', 'link', 'meta', 'base', 'head', 'title', 'audio', 'video', 'source', 'track', 'canvas', 'dialog',
  'portal', 'slot', 'option', 'datalist', 'map', 'area'
])

const MAX_DEPTH = 120
const MAX_NODES = 150_000
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/

/** An absolute URL with one of the given protocols, or null. */
export function safeUrl(raw: string, base: string, protocols: readonly string[]): string | null {
  try {
    const u = new URL(raw.trim(), base)
    return protocols.includes(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

function intAttr(v: string | null, min: number, max: number): string | null {
  if (v === null || !/^\d{1,5}$/.test(v)) return null
  const n = Number(v)
  return n >= min && n <= max ? String(n) : null
}

function copyAttributes(src: Element, dst: Element, tag: string, base: string): boolean {
  const get = (n: string): string | null => src.getAttribute(n)
  switch (tag) {
    case 'a': {
      const href = get('href') ? safeUrl(get('href')!, base, ['http:', 'https:', 'mailto:']) : null
      if (href) {
        dst.setAttribute('href', href)
        dst.setAttribute('rel', 'noopener noreferrer')
      }
      const title = get('title')
      if (title) dst.setAttribute('title', title.slice(0, 300))
      break
    }
    case 'img': {
      const raw = get('src')
      const src = raw ? (DATA_IMAGE.test(raw.trim()) && raw.length < 1_500_000 ? raw.trim() : safeUrl(raw, base, ['http:', 'https:'])) : null
      if (!src) return false // an image without a usable source is dropped
      dst.setAttribute('src', src)
      dst.setAttribute('alt', (get('alt') ?? '').slice(0, 500))
      dst.setAttribute('loading', 'lazy')
      dst.setAttribute('decoding', 'async')
      dst.setAttribute('referrerpolicy', 'no-referrer')
      const w = intAttr(get('width'), 1, 5000)
      const h = intAttr(get('height'), 1, 5000)
      if (w) dst.setAttribute('width', w)
      if (h) dst.setAttribute('height', h)
      const title = get('title')
      if (title) dst.setAttribute('title', title.slice(0, 300))
      break
    }
    case 'td':
    case 'th': {
      const cs = intAttr(get('colspan'), 1, 100)
      const rs = intAttr(get('rowspan'), 1, 100)
      if (cs) dst.setAttribute('colspan', cs)
      if (rs) dst.setAttribute('rowspan', rs)
      break
    }
    case 'ol': {
      const start = intAttr(get('start'), 0, 99999)
      if (start) dst.setAttribute('start', start)
      break
    }
    case 'abbr': {
      const title = get('title')
      if (title) dst.setAttribute('title', title.slice(0, 300))
      break
    }
    case 'time': {
      const dt = get('datetime')
      if (dt && /^[0-9TZ:.+\-\s]{1,40}$/.test(dt)) dst.setAttribute('datetime', dt)
      break
    }
  }
  return true
}

/** Build a safe DocumentFragment (owned by `target`) from untrusted article HTML. */
export function sanitizeArticle(html: string, baseUrl: string, target: Document = document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const out = target.createDocumentFragment()
  let count = 0

  const walk = (from: Node, into: Node, depth: number): void => {
    if (depth > MAX_DEPTH) return
    for (const node of Array.from(from.childNodes)) {
      if (++count > MAX_NODES) return
      if (node.nodeType === Node.TEXT_NODE) {
        into.appendChild(target.createTextNode(node.textContent ?? ''))
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const el = node as Element
      const tag = el.localName.toLowerCase()
      if (DROP.has(tag)) continue
      if (!ALLOWED.has(tag)) {
        walk(el, into, depth + 1) // unknown wrapper: keep its content
        continue
      }
      const copy = target.createElement(tag)
      if (!copyAttributes(el, copy, tag, baseUrl)) continue
      walk(el, copy, depth + 1)
      into.appendChild(copy)
    }
  }
  walk(parsed.body, out, 0)
  return out
}
