import { describe, expect, it } from 'vitest'
import { matchShortcut } from '@shared/shortcuts'
import type { KeyInput } from '@shared/shortcuts'

const k = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...mods
})
const win = (key: string, mods: Partial<KeyInput> = {}): string | null =>
  matchShortcut(k(key, { control: true, ...mods }), 'win32')

describe('Chrome-compatible shortcuts (Windows/Linux)', () => {
  it('tab management', () => {
    expect(win('t')).toBe('newTab')
    expect(win('T', { shift: true })).toBe('reopenTab')
    expect(win('w')).toBe('closeTab')
    expect(win('F4')).toBe('closeTab')
    expect(win('W', { shift: true })).toBe('closeWindow')
    expect(win('Tab')).toBe('nextTab')
    expect(win('Tab', { shift: true })).toBe('prevTab')
    expect(win('PageDown')).toBe('nextTab')
    expect(win('PageUp')).toBe('prevTab')
  })

  it('Ctrl+1..8 select tab n, Ctrl+9 selects the last tab', () => {
    for (let n = 1; n <= 8; n++) expect(win(String(n))).toBe(`selectTab:${n}`)
    expect(win('9')).toBe('lastTab')
  })

  it('navigation and page actions', () => {
    expect(win('l')).toBe('focusAddress')
    expect(matchShortcut(k('d', { alt: true }), 'win32')).toBe('focusAddress')
    expect(matchShortcut(k('F6'), 'win32')).toBe('focusAddress')
    expect(win('f')).toBe('find')
    expect(win('g')).toBe('findNext')
    expect(win('G', { shift: true })).toBe('findPrev')
    expect(matchShortcut(k('F3'), 'win32')).toBe('findNext')
    expect(matchShortcut(k('F3', { shift: true }), 'win32')).toBe('findPrev')
    expect(win('p')).toBe('print')
    expect(win('s')).toBe('savePage')
    expect(win('u')).toBe('viewSource')
    expect(matchShortcut(k('ArrowLeft', { alt: true }), 'win32')).toBe('back')
    expect(matchShortcut(k('ArrowRight', { alt: true }), 'win32')).toBe('forward')
    expect(matchShortcut(k('Home', { alt: true }), 'win32')).toBe('home')
  })

  it('reload, fullscreen, devtools', () => {
    expect(matchShortcut(k('F5'), 'win32')).toBe('reload')
    expect(win('r')).toBe('reload')
    expect(win('R', { shift: true })).toBe('hardReload')
    expect(win('F5')).toBe('hardReload')
    expect(matchShortcut(k('F11'), 'win32')).toBe('fullscreen')
    expect(matchShortcut(k('F12'), 'win32')).toBe('devtools')
    expect(win('I', { shift: true })).toBe('devtools')
  })

  it('zoom keys', () => {
    expect(win('=')).toBe('zoomIn')
    expect(win('+', { shift: true })).toBe('zoomIn')
    expect(win('-')).toBe('zoomOut')
    expect(win('0')).toBe('zoomReset')
  })

  it('windows', () => {
    expect(win('n')).toBe('newWindow')
    expect(win('N', { shift: true })).toBe('newIsolatedWindow')
    expect(win(',')).toBe('settings')
    expect(win('j')).toBe('downloads')
    expect(win('Delete', { shift: true })).toBe('burn')
  })

  it('does not hijack plain typing or editing shortcuts', () => {
    for (const key of ['a', 'Enter', 'Escape', 'Backspace', 'ArrowDown', ' ']) {
      expect(matchShortcut(k(key), 'win32'), key).toBeNull()
    }
    for (const key of ['c', 'v', 'x', 'a', 'z', 'y']) expect(win(key), `ctrl+${key}`).toBeNull()
  })
})

describe('macOS uses Cmd instead of Ctrl', () => {
  it('maps Cmd+T and ignores Ctrl+T', () => {
    expect(matchShortcut(k('t', { meta: true }), 'darwin')).toBe('newTab')
    expect(matchShortcut(k('t', { control: true }), 'darwin')).toBeNull()
  })
})
