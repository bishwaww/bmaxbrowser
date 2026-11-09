import { useEffect, useRef, useState } from 'react'
import { IconChevronDown, IconChevronUp, IconClose } from '../shared-ui/icons'

export function FindView({ data, seq }: { data: { text: string }; seq: number }) {
  const [text, setText] = useState(data.text)
  const [result, setResult] = useState<{ active: number; total: number } | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  // Every time the bar is (re)opened: restore text, focus, and select.
  useEffect(() => {
    setText(data.text)
    setResult(null)
    const el = ref.current
    if (el) {
      el.focus()
      el.select()
    }
    if (data.text) void window.bmax.cmd('find.run', { text: data.text, forward: true, findNext: false })
  }, [seq])

  useEffect(
    () =>
      window.bmax.onPush((m) => {
        if (m.type === 'find-result') setResult({ active: m.activeMatch, total: m.matches })
      }),
    []
  )

  const run = (forward: boolean, findNext: boolean) => {
    void window.bmax.cmd('find.run', { text, forward, findNext })
  }

  return (
    <div className="flex items-center gap-1" style={{ padding: '6px 8px', height: 36 }}>
      <input
        ref={ref}
        aria-label="Find in page"
        value={text}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent outline-none"
        style={{ userSelect: 'text', fontSize: 13, padding: '0 6px' }}
        onChange={(e) => {
          setText(e.target.value)
          void window.bmax.cmd('find.run', { text: e.target.value, forward: true, findNext: false })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            run(!e.shiftKey, true)
          }
        }}
      />
      <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 44, textAlign: 'right' }}>
        {text && result ? `${result.active}/${result.total}` : ''}
      </span>
      <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
      <button className="icon-btn" style={{ width: 28, height: 28 }} title="Previous (Shift+Enter)" onClick={() => run(false, true)}>
        <IconChevronUp size={16} />
      </button>
      <button className="icon-btn" style={{ width: 28, height: 28 }} title="Next (Enter)" onClick={() => run(true, true)}>
        <IconChevronDown size={16} />
      </button>
      <button className="icon-btn" style={{ width: 28, height: 28 }} title="Close (Esc)" onClick={() => void window.bmax.cmd('find.stop')}>
        <IconClose size={16} />
      </button>
    </div>
  )
}
