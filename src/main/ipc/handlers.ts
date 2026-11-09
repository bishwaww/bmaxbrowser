import { dialog, Menu, nativeTheme } from 'electron'
import { readFile } from 'node:fs/promises'
import { parseBookmarksHtml } from '@shared/bookmarks-import'
import { internalUrl } from '@shared/internal'
import { allowHttp } from '../net/privacy-handlers'
import { resolveOmnibox } from '@shared/omnibox'
import { services } from '../services'
import type { Tab } from '../tabs/Tab'
import type { Handlers } from './router'

function tabOf(ctx: { window: { tabById(id: number): Tab | undefined } }, id: number): Tab | undefined {
  return ctx.window.tabById(id)
}

export function createHandlers(): Handlers {
  return {
    'tab.new': (a, { window }) => {
      window.openTab(a?.url ? resolveOmnibox(a.url, services.settings.get().searchEngine).url : services.settings.get().homepage, {
        background: a?.background
      })
    },
    'tab.newContainer': (a, { window }) => {
      window.openTab(a?.url ? resolveOmnibox(a.url, services.settings.get().searchEngine).url : internalUrl('newtab'), {
        partition: services.sessions.newContainerPartition()
      })
    },
    'tab.close': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) ctx.window.closeTab(t)
    },
    'tab.activate': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) ctx.window.activate(t)
    },
    'tab.move': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) ctx.window.moveTab(t, a.index)
    },
    'tab.pin': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) ctx.window.setPinned(t, a.pinned)
    },
    'tab.mute': (a, ctx) => {
      tabOf(ctx, a.id)?.setMuted(a.muted)
    },
    'tab.duplicate': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) ctx.window.duplicate(t)
    },
    'tab.closeOthers': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) ctx.window.closeOthers(t)
    },
    'tab.closeRight': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) ctx.window.closeRight(t)
    },
    'tab.tearOff': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (t) services.windows.tearOff(t, a.screenX, a.screenY)
    },
    'tab.contextMenu': (a, ctx) => {
      const t = tabOf(ctx, a.id)
      if (!t) return
      const w = ctx.window
      const idx = w.tabs.indexOf(t)
      Menu.buildFromTemplate([
        { label: 'New tab', click: () => w.execute('newTab') },
        { type: 'separator' },
        { label: 'Reload', click: () => t.reload() },
        { label: 'Duplicate', click: () => w.duplicate(t) },
        { label: t.pinned ? 'Unpin' : 'Pin', click: () => w.setPinned(t, !t.pinned) },
        { label: t.muted ? 'Unmute site' : 'Mute site', click: () => t.setMuted(!t.muted) },
        { type: 'separator' },
        { label: 'Close', click: () => w.closeTab(t) },
        { label: 'Close other tabs', enabled: w.tabs.length > 1, click: () => w.closeOthers(t) },
        { label: 'Close tabs to the right', enabled: idx < w.tabs.length - 1, click: () => w.closeRight(t) },
        { type: 'separator' },
        { label: 'Reopen closed tab', click: () => w.execute('reopenTab') }
      ]).popup({ window: w.base })
    },
    'nav.go': (a, { window }) => window.go(a.input, a.newTab),
    'nav.back': (_a, { window }) => window.activeTab?.back(),
    'nav.forward': (_a, { window }) => window.activeTab?.forward(),
    'nav.reload': (a, { window }) => window.activeTab?.reload(a?.hard),
    'nav.stop': (_a, { window }) => window.activeTab?.stop(),
    'nav.home': (_a, { window }) => window.execute('home'),
    'window.action': (a, { window }) => {
      if (!a.name.startsWith('zoom')) window.overlays.hideTransient()
      window.execute(a.name)
    },
    'overlay.show': (a, { window }) => {
      // Showing one transient overlay closes the others.
      if (a.kind === 'menu' || a.kind === 'cert' || a.kind === 'shields') window.overlays.hideTransient(a.kind)
      window.overlays.show(a.kind, a.rect, a.data)
    },
    'overlay.hide': (a, { window }) => {
      window.overlays.hide(a.kind)
      if (a.kind === 'find') window.stopFind()
    },
    'overlay.resize': (a, { window }) => window.overlays.resize(a.kind, a.width, a.height),
    'ui.ready': (_a, ctx) => {
      if (ctx.role === 'chrome') {
        ctx.window.pushState()
        ctx.window.sendToChrome({ type: 'settings', settings: services.settings.get() })
      } else if (ctx.overlayKind) {
        ctx.window.overlays.ready(ctx.overlayKind)
        ctx.window.overlays.send(ctx.overlayKind, { type: 'settings', settings: services.settings.get() })
        ctx.window.overlays.send(ctx.overlayKind, { type: 'state', state: ctx.window.state() })
      }
    },
    'find.run': (a, { window }) => window.runFind(a.text, a.forward, a.findNext),
    'find.stop': (_a, { window }) => window.stopFind(),
    'permission.respond': (a) => services.permissions.respond(a.requestId, a.allow, a.remember),
    'cert.get': (a, ctx) => tabOf(ctx, a.tabId)?.certInfo() ?? null,
    'settings.get': () => services.settings.get(),
    'settings.update': (patch) => services.settings.update(patch),
    'stats.get': () => services.stats.get(),
    'theme.get': (_a, { window }) => (window.tor ? 'tor' : nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    'warning.proceedHttp': (a, { tab }) => {
      if (!tab) return
      let host: string
      try {
        host = new URL(a.url).hostname
      } catch {
        return
      }
      if (!/^http:/i.test(a.url)) return
      allowHttp(tab.partition, host)
      tab.loadUrl(a.url)
    },
    'tor.status': () => services.tor.state(),
    'tor.retry': () => {
      services.tor.stop()
      void services.tor.start()
    },
    'tor.newCircuit': async (_a, { window }) => {
      const ok = await services.tor.newCircuit()
      if (ok && window.activeTab) {
        // Drop open connections so the site is re-fetched over a fresh circuit.
        await window.activeTab.session.closeAllConnections()
        window.activeTab.reload(true)
      }
      return ok
    },
    'vault.status': () => services.vault.status(),
    'vault.create': ({ password }) => services.vault.create(password),
    'vault.unlock': ({ password }) => services.vault.unlock(password),
    'vault.lock': () => services.vault.lock(),
    'vault.destroy': ({ password }) => services.vault.destroy(password),
    'bookmarks.list': () => services.vault.bookmarks(),
    'bookmarks.add': (a) => services.vault.addBookmark(a),
    'bookmarks.remove': (a) => services.vault.removeBookmark(a.id),
    'bookmarks.import': async (_a, { window }) => {
      const res = await dialog.showOpenDialog(window.base, {
        title: 'Import bookmarks (HTML file)',
        properties: ['openFile'],
        filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }]
      })
      const file = res.filePaths[0]
      if (res.canceled || !file) return { added: 0 }
      try {
        const html = await readFile(file, 'utf8')
        if (html.length > 30_000_000) return { added: 0, error: 'That file is too large.' }
        return { added: services.vault.importBookmarks(parseBookmarksHtml(html)) }
      } catch (err) {
        return { added: 0, error: err instanceof Error ? err.message : 'Could not read the file.' }
      }
    },
    'passwords.list': () => services.vault.passwords(),
    'passwords.save': (a) => services.vault.savePassword(a),
    'passwords.remove': (a) => services.vault.removePassword(a.id),
    'passwords.reveal': (a) => services.vault.reveal(a.id),
    'shields.get': (_a, { window }) => services.shields.panelInfo(window.activeTab),
    'shields.setSite': (a, { window }) => {
      if (window.activeTab) services.shields.setSite(window.activeTab, a.enabled)
    },
    'shields.pick': async (_a, { window }) => {
      const tab = window.activeTab
      if (!tab) return { added: null }
      window.overlays.hide('shields')
      tab.wc.focus()
      return { added: await services.shields.pick(tab) }
    },
    'shields.allowNavigation': (a, { window }) => {
      if (window.activeTab) services.shields.allowNavigation(window.activeTab, a.url)
    },
    'shields.rules.get': () => services.shields.getRules(),
    'shields.rules.set': (a) => services.shields.setRules(a.text),
    'shields.lists': () => services.shields.listsInfo(),
    'shields.refresh': () => {
      void services.shields.refresh()
    },
    'page.navigate': (a, { tab }) => {
      if (!tab) return
      tab.loadUrl(resolveOmnibox(a.input, services.settings.get().searchEngine).url)
    }
  }
}
