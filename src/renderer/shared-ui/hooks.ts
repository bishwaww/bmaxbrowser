import { useEffect, useState } from 'react'
import type { Settings } from '@shared/settings'
import type { WindowState } from '@shared/types'

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
