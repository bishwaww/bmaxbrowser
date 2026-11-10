import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function preloadPath(name: 'chrome' | 'web'): string {
  return join(__dirname, '../preload', `${name}.js`)
}

/** Window/taskbar icon (Windows and Linux; the packaged executable also embeds it). */
export function iconPath(): string | undefined {
  const p = join(app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources'), 'icons', 'icon.png')
  return existsSync(p) ? p : undefined
}

/** Bundled read-only resources (dictionaries, filter snapshots, binaries). */
export function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
  return join(root, ...parts)
}
