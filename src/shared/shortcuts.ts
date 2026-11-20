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
  | 'newTorWindow'
  | 'bookmarkPage'
  | 'downloads'
  | 'readerMode'
  | 'pictureInPicture'
  | 'newExtensionWindow'
  | 'toggleBookmarksBar'
  | 'bookmarks'

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
    if (key === 'n') return 'newTorWindow'
    if (key === 'r') return 'readerMode'
    if (key === 'p') return 'pictureInPicture'
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
    case 'e':
      return shift ? 'newExtensionWindow' : null
    case 'b':
      return shift ? 'toggleBookmarksBar' : null
    case 'o':
      return shift ? 'bookmarks' : null
    case 's':
      return 'savePage'
    case 'u':
      return 'viewSource'
    case 'i':
      return shift ? 'devtools' : null
    case 'j':
      return 'downloads'
    case 'd':
      return 'bookmarkPage'
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

/** Human-readable shortcut list for Settings → Shortcuts. 'Mod' is Ctrl (Windows/Linux) or ⌘ (macOS). A unit test checks every entry against matchShortcut. */
export interface ShortcutDoc {
  group: string
  label: string
  /** e.g. 'Mod+Shift+T' */
  keys: string
  command: ShortcutCommand
}

export const SHORTCUT_DOCS: readonly ShortcutDoc[] = [
  { group: 'Tabs & windows', label: 'New tab', keys: 'Mod+T', command: 'newTab' },
  { group: 'Tabs & windows', label: 'Close tab', keys: 'Mod+W', command: 'closeTab' },
  { group: 'Tabs & windows', label: 'Reopen closed tab', keys: 'Mod+Shift+T', command: 'reopenTab' },
  { group: 'Tabs & windows', label: 'Next tab', keys: 'Mod+Tab', command: 'nextTab' },
  { group: 'Tabs & windows', label: 'Previous tab', keys: 'Mod+Shift+Tab', command: 'prevTab' },
  { group: 'Tabs & windows', label: 'Go to tab 1', keys: 'Mod+1', command: 'selectTab:1' },
  { group: 'Tabs & windows', label: 'Go to last tab', keys: 'Mod+9', command: 'lastTab' },
  { group: 'Tabs & windows', label: 'New window', keys: 'Mod+N', command: 'newWindow' },
  { group: 'Tabs & windows', label: 'New isolated window', keys: 'Mod+Shift+N', command: 'newIsolatedWindow' },
  { group: 'Tabs & windows', label: 'New window with extensions', keys: 'Mod+Shift+E', command: 'newExtensionWindow' },
  { group: 'Tabs & windows', label: 'New Tor window', keys: 'Mod+Alt+N', command: 'newTorWindow' },
  { group: 'Tabs & windows', label: 'Close window', keys: 'Mod+Shift+W', command: 'closeWindow' },
  { group: 'Navigation', label: 'Focus address bar', keys: 'Mod+L', command: 'focusAddress' },
  { group: 'Navigation', label: 'Back', keys: 'Alt+Left', command: 'back' },
  { group: 'Navigation', label: 'Forward', keys: 'Alt+Right', command: 'forward' },
  { group: 'Navigation', label: 'Home page', keys: 'Alt+Home', command: 'home' },
  { group: 'Navigation', label: 'Reload', keys: 'Mod+R', command: 'reload' },
  { group: 'Navigation', label: 'Reload, ignoring cache', keys: 'Mod+Shift+R', command: 'hardReload' },
  { group: 'Page', label: 'Find in page', keys: 'Mod+F', command: 'find' },
  { group: 'Page', label: 'Find next', keys: 'Mod+G', command: 'findNext' },
  { group: 'Page', label: 'Find previous', keys: 'Mod+Shift+G', command: 'findPrev' },
  { group: 'Page', label: 'Zoom in', keys: 'Mod+=', command: 'zoomIn' },
  { group: 'Page', label: 'Zoom out', keys: 'Mod+-', command: 'zoomOut' },
  { group: 'Page', label: 'Reset zoom', keys: 'Mod+0', command: 'zoomReset' },
  { group: 'Page', label: 'Reader mode', keys: 'Mod+Alt+R', command: 'readerMode' },
  { group: 'Page', label: 'Picture-in-picture', keys: 'Mod+Alt+P', command: 'pictureInPicture' },
  { group: 'Page', label: 'Print', keys: 'Mod+P', command: 'print' },
  { group: 'Page', label: 'Save page as', keys: 'Mod+S', command: 'savePage' },
  { group: 'Page', label: 'Full screen', keys: 'F11', command: 'fullscreen' },
  { group: 'Page', label: 'View page source', keys: 'Mod+U', command: 'viewSource' },
  { group: 'Page', label: 'Developer tools', keys: 'F12', command: 'devtools' },
  { group: 'Browser', label: 'Bookmark this page', keys: 'Mod+D', command: 'bookmarkPage' },
  { group: 'Browser', label: 'Show or hide the bookmarks bar', keys: 'Mod+Shift+B', command: 'toggleBookmarksBar' },
  { group: 'Browser', label: 'All bookmarks', keys: 'Mod+Shift+O', command: 'bookmarks' },
  { group: 'Browser', label: 'Downloads', keys: 'Mod+J', command: 'downloads' },
  { group: 'Browser', label: 'Settings', keys: 'Mod+,', command: 'settings' },
  { group: 'Browser', label: 'Burn all browsing data', keys: 'Mod+Shift+Delete', command: 'burn' }
]

/** Parse 'Mod+Shift+T' into a key event (for tests) for the given platform. */
export function keysToInput(keys: string, platform: string): KeyInput {
  const mac = platform === 'darwin'
  const parts = keys.split(/\+(?=.)/)
  const key = parts[parts.length - 1]!
  const mods = new Set(parts.slice(0, -1))
  const mod = mods.has('Mod')
  const named: Record<string, string> = { Left: 'ArrowLeft', Right: 'ArrowRight' }
  return {
    key: named[key] ?? key,
    control: mac ? false : mod,
    meta: mac ? mod : false,
    shift: mods.has('Shift'),
    alt: mods.has('Alt')
  }
}

/** Display form of a shortcut on a platform ('Mod+Shift+T' → 'Ctrl+Shift+T' / '⌘⇧T'). */
export function formatShortcut(keys: string, platform: string): string {
  if (platform !== 'darwin') return keys.replace('Mod', 'Ctrl')
  return keys
    .replace('Mod+', '⌘')
    .replace('Shift+', '⇧')
    .replace('Alt+', '⌥')
}
