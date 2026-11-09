import { dialog, shell } from 'electron'
import type { BaseWindow } from 'electron'

/** Schemes that are handled inside the browser and must never be handed to the OS. */
const INTERNAL_OR_BROWSER = new Set(['http:', 'https:', 'file:', 'bmax:', 'view-source:', 'about:', 'blob:', 'data:', 'devtools:'])
/** Schemes that are never opened externally, even after confirmation. */
const NEVER_EXTERNAL = new Set(['file:', 'javascript:', 'vbscript:', 'data:', 'blob:', 'chrome:', 'devtools:', 'ms-msdt:', 'search-ms:'])

export function isBrowserHandledUrl(url: string): boolean {
  try {
    return INTERNAL_OR_BROWSER.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** Ask the user before opening a link in another application. Returns true if it was opened. */
export async function confirmAndOpenExternal(url: string, parent: BaseWindow | null): Promise<boolean> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!/^[a-z][a-z0-9+.-]*:$/.test(u.protocol) || NEVER_EXTERNAL.has(u.protocol)) return false
  const shown = url.length > 200 ? `${url.slice(0, 200)}…` : url
  const options = {
    type: 'question' as const,
    buttons: ['Cancel', 'Open'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Open external application?',
    message: `A website wants to open a "${u.protocol.slice(0, -1)}" link in another application.`,
    detail: shown
  }
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (response !== 1) return false
  await shell.openExternal(url)
  return true
}
