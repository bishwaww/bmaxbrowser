import { app } from 'electron'
import { join } from 'node:path'

export function preloadPath(name: 'chrome' | 'web'): string {
  return join(__dirname, '../preload', `${name}.js`)
}

/** Bundled read-only resources (dictionaries, filter snapshots, binaries). */
export function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
  return join(root, ...parts)
}
