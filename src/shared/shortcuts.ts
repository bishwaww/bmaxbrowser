/** Chrome-compatible keyboard shortcuts. Pure so it can be unit-tested. */
export type ShortcutCommand =
  | 'newTab'
  | 'closeTab'
  | 'reopenTab'
  | 'focusAddress'
  | 'nextTab'
  | 'prevTab'
  | 'lastTab'
  | `selectTab:${number}`
  | 'find'
  | 'findNext'
  | 'findPrev'
  | 'print'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'reload'
  | 'hardReload'
  | 'fullscreen'
  | 'devtools'
  | 'viewSource'
  | 'newWindow'
  | 'newIsolatedWindow'
  | 'savePage'
  | 'back'
  | 'forward'
  | 'home'
  | 'closeWindow'
  | 'settings'
  | 'burn'
  | 'downloads'

export interface KeyInput {
  key: string
  code?: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export function matchShortcut(input: KeyInput, platform: string): ShortcutCommand | null {
  const mac = platform === 'darwin'
  const mod = mac ? input.meta : input.control
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  const { shift, alt } = input

  if (!mod && !alt) {
    switch (input.key) {
      case 'F5':
        return 'reload'
      case 'F11':
        return 'fullscreen'
      case 'F12':
        return 'devtools'
      case 'F6':
        return 'focusAddress'
      case 'F3':
        return shift ? 'findPrev' : 'findNext'
      default:
        return null
    }
  }

  if (alt && !mod) {
    if (input.key === 'ArrowLeft') return 'back'
    if (input.key === 'ArrowRight') return 'forward'
    if (input.key === 'Home') return 'home'
    if (key === 'd') return 'focusAddress'
    return null
  }

  if (mod && alt) {
    if (key === 'i') return 'devtools'
    return null
  }

  // From here: mod pressed, alt not.
  if (/^[1-9]$/.test(key) && !shift) return key === '9' ? 'lastTab' : (`selectTab:${Number(key)}` as const)
  switch (key) {
    case 't':
      return shift ? 'reopenTab' : 'newTab'
    case 'w':
      return shift ? 'closeWindow' : 'closeTab'
    case 'F4':
      return 'closeTab'
    case 'Tab':
      return shift ? 'prevTab' : 'nextTab'
    case 'PageDown':
      return 'nextTab'
    case 'PageUp':
      return 'prevTab'
    case 'l':
      return 'focusAddress'
    case 'f':
      return 'find'
    case 'g':
      return shift ? 'findPrev' : 'findNext'
    case 'p':
      return 'print'
    case 'r':
      return shift ? 'hardReload' : 'reload'
    case 'F5':
      return 'hardReload'
    case 'n':
      return shift ? 'newIsolatedWindow' : 'newWindow'
    case 's':
      return 'savePage'
    case 'u':
      return 'viewSource'
    case 'i':
      return shift ? 'devtools' : null
    case 'j':
      return 'downloads'
    case ',':
      return 'settings'
    case '+':
    case '=':
      return 'zoomIn'
    case '-':
    case '_':
      return 'zoomOut'
    case '0':
      return 'zoomReset'
    case 'Delete':
      return shift ? 'burn' : null
    default:
      return null
  }
}
