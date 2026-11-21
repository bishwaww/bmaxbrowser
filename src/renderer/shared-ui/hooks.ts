import { useEffect, useState } from 'react'
import type { Settings } from '@shared/settings'
import type { WindowState } from '@shared/types'
import type { UpdateState } from '@shared/updates'

/** Live window state pushed by main (chrome UI + overlays). */
export function useWindowState(): WindowState | null {
  const [state, setState] = useState<WindowState | null>(null)
  useEffect(() => {
    const off = window.bmax.onPush((m) => {
      if (m.type === 'state') setState(m.state)
    })
    void window.bmax.cmd('ui.ready')
    return off
  }, [])
  return state
}

/** Site icons (data: URLs) for these addresses, as far as BMAX knows them. Refreshed when bookmarks change. */
export function useSiteIcons(urls: string[]): Record<string, string | null> {
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const key = urls.slice(0, 300).join('\n')
  useEffect(() => {
    if (!key) return
    let alive = true
    const load = (): void => void window.bmax.cmd('icons.get', { urls: key.split('\n') }).then((r) => alive && setIcons(r))
    load()
    const off = window.bmax.onPush((m) => {
      if (m.type === 'bookmarks') load()
    })
    return () => {
      alive = false
      off()
    }
  }, [key])
  return icons
}

/** App update state (checked in the background; pushed by main when it changes). */
export function useUpdateState(): UpdateState | null {
  const [st, setSt] = useState<UpdateState | null>(null)
  useEffect(() => {
    let alive = true
    void window.bmax.cmd('app.info').then((i) => alive && setSt((cur) => cur ?? i.updates))
    const off = window.bmax.onPush((m) => {
      if (m.type === 'updates') setSt(m.state)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return st
}

/** Settings, kept in sync via push messages. Works for every role that may call settings.get. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let alive = true
    void window.bmax.cmd('settings.get').then((s) => alive && setSettings(s))
    const off = window.bmax.onPush((m) => {
      if (m.type === 'settings') setSettings(m.settings)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return settings
}
