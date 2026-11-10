import { clipboard, Menu } from 'electron'
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'
import { searchUrl } from '@shared/search-engines'
import { services } from '../services'
import type { Tab } from './Tab'

function truncate(s: string, n = 30): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

export function buildContextMenu(tab: Tab, p: ContextMenuParams): Menu {
  const wc = tab.wc
  const win = tab.window
  const t: MenuItemConstructorOptions[] = []
  const sep = (): void => {
    if (t.length && t[t.length - 1]?.type !== 'separator') t.push({ type: 'separator' })
  }

  // Spelling suggestions first, like Chrome.
  if (p.isEditable && p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) {
      t.push({ label: s, click: () => wc.replaceMisspelling(s) })
    }
    t.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) })
    sep()
  }

  if (p.linkURL) {
    t.push(
      { label: 'Open link in new tab', click: () => win.openTab(p.linkURL, { background: true, partition: tab.partition }) },
      { label: 'Open link in new window', click: () => services.windows.create({ url: p.linkURL, partition: tab.partition, tor: win.tor, isolated: win.isolated, extensions: win.extensions }) },
      { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) }
    )
    sep()
  }

  if (p.mediaType === 'image' && p.srcURL) {
    t.push(
      { label: 'Open image in new tab', click: () => win.openTab(p.srcURL, { background: false, partition: tab.partition }) },
      { label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) },
      { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) }
    )
    sep()
  }
  if (p.mediaType === 'video') {
    t.push({ label: 'Picture in picture', click: () => void tab.togglePictureInPicture(p.frame ?? undefined) })
  }
  if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && !p.srcURL.startsWith('blob:')) {
    t.push(
      { label: `Open ${p.mediaType} in new tab`, click: () => win.openTab(p.srcURL, { background: false, partition: tab.partition }) },
      { label: `Copy ${p.mediaType} address`, click: () => clipboard.writeText(p.srcURL) }
    )
    sep()
  }

  if (p.isEditable) {
    t.push(
      { label: 'Undo', role: 'undo', enabled: p.editFlags.canUndo },
      { label: 'Redo', role: 'redo', enabled: p.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: p.editFlags.canCut },
      { label: 'Copy', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: p.editFlags.canPaste },
      { label: 'Select all', role: 'selectAll', enabled: p.editFlags.canSelectAll }
    )
    sep()
  } else if (p.selectionText) {
    const sel = p.selectionText.trim()
    t.push({ label: 'Copy', role: 'copy' })
    if (sel) {
      const engine = services.settings.get().searchEngine
      t.push({
        label: `Search for "${truncate(sel)}"`,
        click: () => win.openTab(searchUrl(engine, sel.slice(0, 500)), { background: false, partition: tab.partition })
      })
    }
    sep()
  }

  if (!p.linkURL && !p.isEditable && !p.selectionText && p.mediaType === 'none') {
    t.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => tab.back() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => tab.forward() },
      { label: 'Reload', click: () => tab.reload() }
    )
    sep()
    t.push(
      { label: 'Save page as…', click: () => win.execute('savePage') },
      { label: 'Print…', click: () => tab.print() }
    )
    sep()
    t.push(
      { label: 'Reader mode', click: () => win.execute('readerMode') },
      { label: 'View page source', click: () => win.execute('viewSource') }
    )
  }
  sep()
  t.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) })

  while (t[t.length - 1]?.type === 'separator') t.pop()
  return Menu.buildFromTemplate(t)
}
