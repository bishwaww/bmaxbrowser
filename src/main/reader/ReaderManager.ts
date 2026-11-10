import readabilitySource from '@mozilla/readability/Readability.js?raw'
import { randomBytes } from 'node:crypto'
import { internalUrl } from '@shared/internal'
import { READER_MAX_HTML } from '@shared/reader'
import type { Article } from '@shared/reader'
import type { Tab } from '../tabs/Tab'

/**
 * Runs inside the page (main world, wrapped so nothing leaks into the page's globals): Mozilla Readability on a
 * clone of the document. The result is untrusted (a hostile page can influence it) and is sanitized again by the
 * reader page with an allow-list before anything is shown.
 */
const EXTRACT_SCRIPT = `(() => {
  const module = { exports: {} };
  ${readabilitySource}
  ;
  const doc = document.cloneNode(true);
  const r = new Readability(doc, { charThreshold: 250 }).parse();
  const text = ((r && r.textContent) || '').trim();
  // Readability always returns its best guess; a page with hardly any text is not an article.
  if (!r || !r.content || text.length < 200) return null;
  return {
    title: String(r.title || document.title || ''),
    byline: String(r.byline || ''),
    siteName: String(r.siteName || ''),
    excerpt: String(r.excerpt || ''),
    html: String(r.content),
    lang: String(r.lang || document.documentElement.lang || ''),
    dir: String(r.dir || document.documentElement.dir || ''),
    words: text ? text.split(/\\s+/).length : 0
  };
})()`

const MAX_ARTICLES = 12

function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** Validate what came back from the page (it is data from an untrusted source). */
export function coerceArticle(raw: unknown, url: string): Article | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const html = typeof r['html'] === 'string' ? r['html'] : ''
  if (!html || html.length > READER_MAX_HTML) return null
  const dir = r['dir'] === 'rtl' ? 'rtl' : r['dir'] === 'ltr' ? 'ltr' : ''
  const words = typeof r['words'] === 'number' && Number.isFinite(r['words']) ? Math.max(0, Math.min(5_000_000, Math.round(r['words']))) : 0
  return {
    title: clip(r['title'], 300),
    byline: clip(r['byline'], 300),
    siteName: clip(r['siteName'], 120),
    excerpt: clip(r['excerpt'], 600),
    url,
    html,
    lang: clip(r['lang'], 20),
    dir,
    words
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** Reader mode: extract the article of a tab and show it on the bmax://reader page (memory only; cleared by Burn). */
export class ReaderManager {
  private articles = new Map<string, Article>()

  async extract(tab: Tab): Promise<Article | null> {
    const url = tab.url
    if (!/^(https?|file):/i.test(url) || tab.sleeping || tab.isDestroyed) return null
    try {
      const raw = await withTimeout(tab.wc.mainFrame.executeJavaScript(EXTRACT_SCRIPT), 10_000)
      return coerceArticle(raw, url)
    } catch {
      return null
    }
  }

  /** Replace the tab's page by its reader view (Back returns to the page). */
  async open(tab: Tab): Promise<boolean> {
    const url = tab.url
    const article = await this.extract(tab)
    let id = 'none'
    if (article) {
      id = randomBytes(16).toString('hex')
      this.articles.set(id, article)
      while (this.articles.size > MAX_ARTICLES) this.articles.delete(this.articles.keys().next().value as string)
    }
    if (tab.isDestroyed) return false
    tab.loadUrl(internalUrl('reader', `?${new URLSearchParams({ id, url }).toString()}`))
    return article !== null
  }

  get(id: string): Article | null {
    return this.articles.get(id) ?? null
  }

  clear(): void {
    this.articles.clear()
  }
}
