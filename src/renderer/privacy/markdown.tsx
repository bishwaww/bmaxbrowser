import type { ReactNode } from 'react'

/** A tiny Markdown renderer for docs/PRIVACY.md (headings, paragraphs, lists, tables, **bold**, `code`, [links](https://…)). Builds React elements only; nothing is injected as HTML. */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let n = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const tok = m[0]
    const key = `${keyBase}-${n++}`
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok) ?? []
      if (label && href && /^https?:\/\//i.test(href)) {
        out.push(
          <a
            key={key}
            href={href}
            onClick={(e) => {
              e.preventDefault()
              void window.bmax.cmd('page.navigate', { input: href })
            }}
          >
            {label}
          </a>
        )
      } else out.push(tok)
    }
    last = i + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1]!.length
      const content = inline(h[2]!, `h${k}`)
      blocks.push(level === 1 ? <h1 key={k++}>{content}</h1> : level === 2 ? <h2 key={k++}>{content}</h2> : <h3 key={k++}>{content}</h3>)
      i++
      continue
    }
    if (line.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!))
      blocks.push(
        <div key={k++} className="table-wrap">
          <table>
            <thead>
              <tr>
                {head.map((c, ci) => (
                  <th key={ci}>{inline(c, `th${k}-${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{inline(c, `td${k}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && lines[i]!.trim()) {
        const l = lines[i]!
        if (/^-\s+/.test(l)) items.push(l.replace(/^-\s+/, ''))
        else if (items.length && /^\s+\S/.test(l)) items[items.length - 1] += ` ${l.trim()}`
        else break
        i++
      }
      blocks.push(
        <ul key={k++}>
          {items.map((it, ii) => (
            <li key={ii}>{inline(it, `li${k}-${ii}`)}</li>
          ))}
        </ul>
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|\s*-\s+|\s*\|)/.test(lines[i]!)) para.push(lines[i++]!.trim())
    if (para.length === 0) {
      i++
      continue
    }
    blocks.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>)
  }
  return <>{blocks}</>
}
