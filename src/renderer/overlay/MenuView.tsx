import { useEffect, useState } from 'react'
import type { WindowState } from '@shared/types'
import type { CommandArgs } from '@shared/ipc'

type ActionName = CommandArgs<'window.action'>['name']

function Row({ label, hint, onClick, disabled }: { label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      className="flex w-full items-center justify-between px-4 text-left hover:bg-[var(--hover)] disabled:opacity-40"
      style={{ height: 34, fontSize: 13 }}
      onClick={onClick}
    >
      <span>{label}</span>
      {hint && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{hint}</span>}
    </button>
  )
}

const Sep = () => <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

export function MenuView() {
  const [state, setState] = useState<WindowState | null>(null)
  useEffect(() => window.bmax.onPush((m) => m.type === 'state' && setState(m.state)), [])
  const mac = window.bmax.platform === 'darwin'
  const mod = mac ? '⌘' : 'Ctrl+'
  const act = (name: ActionName) => () => {
    void window.bmax.cmd('window.action', { name })
  }
  return (
    <div style={{ padding: '6px 0' }}>
      <Row
        label="New tab"
        hint={`${mod}T`}
        onClick={() => {
          void window.bmax.cmd('tab.new')
          void window.bmax.cmd('overlay.hide', { kind: 'menu' })
        }}
      />
      <Row label="New window" hint={`${mod}N`} onClick={act('newWindow')} />
      <Row label="New isolated window" hint={`${mod}Shift+N`} onClick={act('newIsolatedWindow')} />
      <Row label="New window with extensions" hint={`${mod}Shift+E`} onClick={act('newExtensionWindow')} />
      <Row
        label="New container tab"
        onClick={() => {
          void window.bmax.cmd('tab.newContainer')
          void window.bmax.cmd('overlay.hide', { kind: 'menu' })
        }}
      />
      <Row label="New Tor window" hint={mac ? '⌘⌥N' : 'Ctrl+Alt+N'} onClick={act('newTorWindow')} />
      <Sep />
      <div className="flex items-center justify-between px-4" style={{ height: 36 }}>
        <span>Zoom</span>
        <div className="flex items-center gap-1">
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={act('zoomOut')} aria-label="Zoom out">
            −
          </button>
          <button
            className="rounded px-2 text-xs hover:bg-[var(--hover)]"
            style={{ minWidth: 48, height: 26 }}
            onClick={act('zoomReset')}
            title="Reset zoom"
          >
            {state?.zoomPercent ?? 100}%
          </button>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={act('zoomIn')} aria-label="Zoom in">
            +
          </button>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={act('fullscreen')} aria-label="Full screen" title="Full screen (F11)">
            ⛶
          </button>
        </div>
      </div>
      <Sep />
      <Row label="Reader mode" hint={mac ? '⌘⌥R' : 'Ctrl+Alt+R'} onClick={act('readerMode')} />
      <Row label="Picture-in-picture" hint={mac ? '⌘⌥P' : 'Ctrl+Alt+P'} onClick={act('pictureInPicture')} />
      <Row label="Find in page…" hint={`${mod}F`} onClick={act('find')} />
      <Row label="Print…" hint={`${mod}P`} onClick={act('print')} />
      <Row label="Save page as…" hint={`${mod}S`} onClick={act('savePage')} />
      <Row label="View page source" hint={`${mod}U`} onClick={act('viewSource')} />
      <Row label="Developer tools" hint="F12" onClick={act('devtools')} />
      <Sep />
      <Row label="Bookmarks" hint={`${mod}Shift+O`} onClick={act('bookmarks')} />
      <Row label={state?.showBookmarksBar ? 'Hide bookmarks bar' : 'Show bookmarks bar'} hint={`${mod}Shift+B`} onClick={act('toggleBookmarksBar')} />
      <Row
        label="Saved passwords"
        onClick={() => {
          void window.bmax.cmd('tab.new', { url: 'bmax://bookmarks/?tab=passwords' })
          void window.bmax.cmd('overlay.hide', { kind: 'menu' })
        }}
      />
      <Row label="Download video from this page" onClick={act('downloadMedia')} />
      <Row label="Downloads" hint={`${mod}J`} onClick={act('downloads')} />
      <Row
        label="Torrents"
        onClick={() => {
          void window.bmax.cmd('tab.new', { url: 'bmax://torrents' })
          void window.bmax.cmd('overlay.hide', { kind: 'menu' })
        }}
      />
      <Row label="Burn all browsing data" hint={`${mod}Shift+Del`} onClick={act('burn')} />
      <Row label="Settings" hint={`${mod},`} onClick={act('settings')} />
      <Row
        label="Privacy policy"
        onClick={() => {
          void window.bmax.cmd('tab.new', { url: 'bmax://privacy' })
          void window.bmax.cmd('overlay.hide', { kind: 'menu' })
        }}
      />
    </div>
  )
}
