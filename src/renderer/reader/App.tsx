import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { readingMinutes } from '@shared/reader'
import type { Article } from '@shared/reader'
import type { Settings } from '@shared/settings'
import { useSettings } from '../shared-ui/hooks'
import { sanitizeArticle } from './sanitize'
import './reader.css'

type State = { kind: 'loading' } | { kind: 'none' } | { kind: 'ready'; article: Article }

const params = new URLSearchParams(location.search)
const articleId = params.get('id') ?? ''
const originalUrl = params.get('url') ?? ''

export function App() {
  const settings = useSettings()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!/^[0-9a-f]{32}$/.test(articleId)) {
      setState({ kind: 'none' })
      return
    }
    void window.bmax.cmd('reader.get', { id: articleId }).then((a) => setState(a ? { kind: 'ready', article: a } : { kind: 'none' }))
  }, [])

  useEffect(() => {
    if (state.kind !== 'ready' || !body.current) return
    body.current.replaceChildren(sanitizeArticle(state.article.html, state.article.url))
    document.title = `${state.article.title || 'Article'} (reader)`
  }, [state])

  useEffect(() => {
    if (state.kind === 'none') document.title = 'Reader mode'
  }, [state])

  if (!settings) return null
  const r = settings.reader
  const setReader = (patch: Partial<Settings['reader']>) => void window.bmax.cmd('settings.update', { reader: { ...r, ...patch } })
  const leave = () => {
    if (/^(https?|file):/i.test(originalUrl)) void window.bmax.cmd('page.navigate', { input: originalUrl })
  }
  // Links inside the article open in this tab (internal pages may not navigate by themselves).
  const onContentClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href')
    if (href && /^https?:/i.test(href)) void window.bmax.cmd('page.navigate', { input: href })
  }

  const article = state.kind === 'ready' ? state.article : null
  return (
    <div className="reader" data-rt={r.theme} data-font={r.font} style={{ ['--reader-size' as string]: `${r.size}px` }}>
      <header className="reader-bar" role="toolbar" aria-label="Reader controls">
        <button onClick={leave} title="Back to the original page">
          ← Original page
        </button>
        <span className="spacer" />
        <button aria-label="Smaller text" disabled={r.size <= 12} onClick={() => setReader({ size: Math.max(12, r.size - 1) })}>
          A−
        </button>
        <button aria-label="Larger text" disabled={r.size >= 32} onClick={() => setReader({ size: Math.min(32, r.size + 1) })}>
          A+
        </button>
        <button aria-pressed={r.font === 'serif'} onClick={() => setReader({ font: r.font === 'serif' ? 'sans' : 'serif' })} title="Switch font">
          {r.font === 'serif' ? 'Serif' : 'Sans'}
        </button>
        <select aria-label="Reader colours" value={r.theme} onChange={(e) => setReader({ theme: e.target.value as Settings['reader']['theme'] })}>
          <option value="auto">Match browser</option>
          <option value="light">Light</option>
          <option value="sepia">Sepia</option>
          <option value="dark">Dark</option>
        </select>
      </header>

      <main className="reader-main" dir={article?.dir || undefined} lang={article?.lang || undefined}>
        {state.kind === 'loading' && <p className="reader-note">Loading…</p>}
        {state.kind === 'none' && (
          <div className="reader-note" data-testid="reader-unavailable">
            <h1>Reader mode isn&rsquo;t available for this page</h1>
            <p>BMAX could not find an article to show. Reader mode works best on news stories, blog posts and documentation pages.</p>
            {originalUrl && <button onClick={leave}>Back to the page</button>}
          </div>
        )}
        {article && (
          <article>
            <h1 data-testid="reader-title">{article.title}</h1>
            <p className="reader-meta">
              {[article.byline, article.siteName || hostOf(article.url), `${readingMinutes(article.words)} min read`].filter(Boolean).join(' · ')}
            </p>
            <div ref={body} className="reader-body" data-testid="reader-body" onClick={onContentClick} />
          </article>
        )}
      </main>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
