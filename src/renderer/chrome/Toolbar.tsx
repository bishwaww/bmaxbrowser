import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { displayUrl, resolveOmnibox } from '@shared/omnibox'
import type { Settings } from '@shared/settings'
import type { OverlayKind, SuggestionItem, TabInfo, WindowState } from '@shared/types'
import {
  IconBack,
  IconDownload,
  IconShieldCheck,
  IconCircuit,
  IconFlame,
  IconStar,
  IconForward,
  IconHome,
  IconLock,
  IconMenu,
  IconReload,
  IconShield,
  IconStop,
  IconWarning,
  IconFile
} from '../shared-ui/icons'

function buildSuggestions(text: string, state: WindowState, engine: string): SuggestionItem[] {
  const t = text.trim()
  if (!t) return []
  const r = resolveOmnibox(t, engine)
  const items: SuggestionItem[] = [
    r.kind === 'url'
      ? { kind: 'url', text: r.url.replace(/^https?:\/\//, ''), url: r.url }
      : { kind: 'search', text: t, url: t }
  ]
  const q = t.toLowerCase()
  for (const tab of state.tabs) {
    if (items.length >= 5) break
    if (tab.id === state.activeTabId) continue
    if (tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)) {
      items.push({ kind: 'tab', text: tab.title || tab.url, url: tab.url, tabId: tab.id })
    }
  }
  return items
}

function Padlock({ tab, onClick }: { tab: TabInfo | undefined; onClick: (rect: DOMRect) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const sec = tab?.security ?? 'none'
  const label =
    sec === 'secure'
      ? 'Connection is secure'
      : sec === 'insecure'
        ? 'Not secure'
        : sec === 'error'
          ? 'Certificate problem'
          : sec === 'internal'
            ? 'BMAX page'
            : sec === 'file'
              ? 'Local file'
              : 'Site information'
  const icon =
    sec === 'secure' ? (
      <IconLock size={15} />
    ) : sec === 'insecure' || sec === 'error' ? (
      <IconWarning size={15} />
    ) : sec === 'file' ? (
      <IconFile size={15} />
    ) : (
      <IconShield size={15} />
    )
  const danger = sec === 'insecure' || sec === 'error'
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      className="flex h-7 items-center gap-1 rounded-full px-2"
      style={{ color: danger ? 'var(--danger)' : 'var(--muted)' }}
      onClick={() => ref.current && onClick(ref.current.getBoundingClientRect())}
    >
      {icon}
      {sec === 'insecure' && <span style={{ fontSize: 12 }}>Not secure</span>}
    </button>
  )
}

function UrlText({ url }: { url: string }) {
  const shown = displayUrl(url)
  let host = ''
  let rest = shown
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      host = u.host
      rest = (u.pathname + u.search + u.hash).replace(/^\/$/, '')
      if (u.protocol === 'http:') host = `http://${host}`
    }
  } catch {
    /* show raw */
  }
  if (!host) return <span>{shown}</span>
  return (
    <>
      <span>{host}</span>
      <span style={{ color: 'var(--muted)' }}>{rest}</span>
    </>
  )
}

export function Toolbar({
  state,
  settings,
  toggleOverlay
}: {
  state: WindowState
  settings: Settings | null
  toggleOverlay: (kind: OverlayKind, rect: { x: number; y: number; width: number; height: number }, data?: unknown) => void
}) {
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const blurTimer = useRef<number | null>(null)
  const engine = settings?.searchEngine ?? 'duckduckgo'

  const items = focused ? buildSuggestions(text, state, engine) : []

  // Push suggestion list to the overlay whenever it changes.
  useEffect(() => {
    const el = fieldRef.current
    if (!el) return
    if (!focused || items.length === 0) {
      void window.bmax.cmd('overlay.hide', { kind: 'suggest' })
      return
    }
    const r = el.getBoundingClientRect()
    void window.bmax.cmd('overlay.show', {
      kind: 'suggest',
      rect: { x: r.left - 8, y: r.bottom - 2, width: r.width + 16, height: 40 * items.length + 24 },
      data: { items, selected }
    })
  }, [focused, text, selected, state.tabs.length])

  // Keep the field in sync with the active tab unless the user is typing.
  useEffect(() => {
    if (!focused) setText(tab && !tab.isNewTab ? tab.url : '')
  }, [tab?.url, tab?.isNewTab, focused, tab])

  useEffect(
    () =>
      window.bmax.onPush((m) => {
        if (m.type === 'focus-omnibox') {
          const input = inputRef.current
          if (!input) return
          input.focus()
          if (m.select) input.select()
        }
      }),
    []
  )

  const submit = useCallback(
    (newTab: boolean) => {
      const item = items[selected]
      if (item?.kind === 'tab' && item.tabId !== undefined) {
        void window.bmax.cmd('tab.activate', { id: item.tabId })
      } else {
        void window.bmax.cmd('nav.go', { input: item?.url ?? text, newTab })
      }
      void window.bmax.cmd('overlay.hide', { kind: 'suggest' })
      inputRef.current?.blur()
    },
    [items, selected, text]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit(e.altKey)
    } else if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault()
      setSelected((s) => (s + 1) % items.length)
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault()
      setSelected((s) => (s - 1 + items.length) % items.length)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setText(tab && !tab.isNewTab ? tab.url : '')
      inputRef.current?.blur()
    }
  }

  const loading = tab?.loading ?? false
  return (
    <div
      className="relative flex items-center gap-1"
      style={{ height: 44, padding: '0 8px', background: 'var(--bar)', borderBottom: '1px solid var(--border)' }}
    >
      <button className="icon-btn" title="Back (Alt+Left)" disabled={!tab?.canGoBack} onClick={() => void window.bmax.cmd('nav.back')}>
        <IconBack />
      </button>
      <button
        className="icon-btn"
        title="Forward (Alt+Right)"
        disabled={!tab?.canGoForward}
        onClick={() => void window.bmax.cmd('nav.forward')}
      >
        <IconForward />
      </button>
      <button
        className="icon-btn"
        title={loading ? 'Stop loading' : 'Reload (F5)'}
        onClick={() => void window.bmax.cmd(loading ? 'nav.stop' : 'nav.reload', loading ? undefined : {})}
      >
        {loading ? <IconStop /> : <IconReload />}
      </button>
      {state.showHomeButton && (
        <button className="icon-btn" title="Home (Alt+Home)" onClick={() => void window.bmax.cmd('nav.home')}>
          <IconHome />
        </button>
      )}

      <div
        ref={fieldRef}
        className="flex min-w-0 flex-1 items-center"
        style={{
          height: 32,
          borderRadius: 16,
          background: 'var(--field)',
          boxShadow: focused ? '0 0 0 2px var(--accent) inset' : undefined,
          margin: '0 6px'
        }}
      >
        <Padlock
          tab={tab}
          onClick={(r) => {
            if (!tab) return
            toggleOverlay('cert', { x: r.left - 4, y: r.bottom + 6, width: 344, height: 200 }, { tabId: tab.id, url: tab.url, security: tab.security })
          }}
        />
        <div className="relative min-w-0 flex-1" style={{ height: 32 }}>
          {!focused && tab && !tab.isNewTab && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center truncate"
              style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden' }}
            >
              <UrlText url={tab.url} />
            </div>
          )}
          <input
            ref={inputRef}
            aria-label="Address bar"
            spellCheck={false}
            autoComplete="off"
            placeholder={tab?.isNewTab ? 'Search or enter address' : ''}
            className="h-full w-full bg-transparent outline-none"
            style={{
              fontSize: 13,
              userSelect: 'text',
              color: !focused && tab && !tab.isNewTab ? 'transparent' : 'var(--fg)',
              caretColor: 'var(--fg)'
            }}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setSelected(0)
            }}
            onFocus={(e) => {
              if (blurTimer.current) window.clearTimeout(blurTimer.current)
              setFocused(true)
              setText(tab && !tab.isNewTab ? tab.url : '')
              e.currentTarget.select()
            }}
            onBlur={() => {
              // Delay so a click on the suggestion overlay is not lost.
              blurTimer.current = window.setTimeout(() => setFocused(false), 160)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {tab && /^https?:\/\//i.test(tab.url) && tab.media.videos + tab.media.audios + tab.media.sniffed + (tab.media.images >= 3 ? 1 : 0) > 0 && (
          <DownloadButton toggleOverlay={toggleOverlay} count={tab.media.videos + tab.media.audios + tab.media.sniffed} />
        )}
        {state.zoomPercent !== 100 && (
          <button
            className="mr-2 rounded-full px-2 text-xs"
            style={{ background: 'var(--hover)' }}
            title="Reset zoom (Ctrl+0)"
            onClick={() => void window.bmax.cmd('window.action', { name: 'zoomReset' })}
          >
            {state.zoomPercent}%
          </button>
        )}
      </div>

      <ShieldsButton tab={tab} toggleOverlay={toggleOverlay} />
      {tab && /^https?:\/\//i.test(tab.url) && (
        <button
          className="icon-btn"
          title={tab.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
          aria-label="Bookmark this page"
          style={{ color: tab.bookmarked ? 'var(--accent)' : undefined }}
          onClick={() => void window.bmax.cmd('window.action', { name: 'bookmarkPage' })}
        >
          <IconStar filled={tab.bookmarked} />
        </button>
      )}
      {state.tor && <TorControls />}
      <button
        className="icon-btn"
        title="Burn: wipe all browsing data and close everything (Ctrl+Shift+Del)"
        aria-label="Burn all browsing data"
        onClick={() => void window.bmax.cmd('window.action', { name: 'burn' })}
      >
        <IconFlame />
      </button>
      <MenuButton state={state} toggleOverlay={toggleOverlay} />

      {loading && tab && (
        <div
          className="absolute left-0 bottom-0"
          style={{ height: 2, width: `${Math.round(state.progress * 100)}%`, background: 'var(--accent)', transition: 'width 300ms ease' }}
        />
      )}
    </div>
  )
}

function DownloadButton({
  toggleOverlay,
  count
}: {
  toggleOverlay: (kind: OverlayKind, rect: { x: number; y: number; width: number; height: number }, data?: unknown) => void
  count: number
}) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      className="icon-btn mr-1"
      style={{ width: 28, height: 28 }}
      title={count > 0 ? 'Download media from this page' : 'Save images from this page'}
      aria-label="Download media from this page"
      onClick={() => {
        const r = ref.current?.getBoundingClientRect()
        if (r) toggleOverlay('media', { x: Math.max(8, r.right - 408), y: r.bottom + 8, width: 408, height: 420 }, {})
      }}
    >
      <IconDownload size={16} />
    </button>
  )
}

function ShieldsButton({
  tab,
  toggleOverlay
}: {
  tab: TabInfo | undefined
  toggleOverlay: (kind: OverlayKind, rect: { x: number; y: number; width: number; height: number }, data?: unknown) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const on = tab?.shields.enabled ?? true
  const count = tab?.shields.blocked ?? 0
  return (
    <button
      ref={ref}
      className="icon-btn relative"
      aria-label={`Shields: ${count} blocked`}
      title={on ? `Shields are up — ${count} blocked on this page` : 'Shields are off for this site'}
      style={{ color: on ? 'var(--accent)' : 'var(--muted)' }}
      onClick={() => {
        const r = ref.current?.getBoundingClientRect()
        if (r) toggleOverlay('shields', { x: Math.max(8, r.right - 372), y: r.bottom + 4, width: 372, height: 380 }, {})
      }}
    >
      <IconShieldCheck />
      {on && count > 0 && (
        <span
          className="absolute rounded-full text-center font-semibold"
          style={{ top: 0, right: -2, minWidth: 15, height: 15, lineHeight: '15px', fontSize: 9, padding: '0 3px', background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

function TorControls() {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.bmax.cmd('tor.status').then((s) => setReady(s.status === 'ready'))
    return window.bmax.onPush((m) => m.type === 'tor-status' && setReady(m.state.status === 'ready'))
  }, [])
  return (
    <>
      <span
        className="rounded-full px-2 text-xs font-semibold"
        style={{ background: 'var(--accent)', color: 'var(--on-accent)', height: 20, lineHeight: '20px' }}
        title="This window routes all traffic through the Tor network"
      >
        TOR
      </span>
      <button
        className="icon-btn"
        disabled={!ready || busy}
        title="New Tor circuit for this site"
        aria-label="New Tor circuit for this site"
        onClick={() => {
          setBusy(true)
          void window.bmax.cmd('tor.newCircuit').finally(() => setBusy(false))
        }}
      >
        <IconCircuit />
      </button>
    </>
  )
}

function MenuButton({
  state,
  toggleOverlay
}: {
  state: WindowState
  toggleOverlay: (kind: OverlayKind, rect: { x: number; y: number; width: number; height: number }, data?: unknown) => void
}) {
  return (
    <button
      className="icon-btn"
      title="Menu"
      aria-label="Menu"
      onClick={() => toggleOverlay('menu', { x: window.innerWidth - 304, y: 82, width: 296, height: 440 }, { platform: state.platform })}
    >
      <IconMenu />
    </button>
  )
}
