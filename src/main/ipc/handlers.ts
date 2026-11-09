import { Menu, nativeTheme } from 'electron'
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
      if (a.kind === 'menu' || a.kind === 'cert') window.overlays.hideTransient(a.kind)
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
    'theme.get': () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    'page.navigate': (a, { tab }) => {
      if (!tab) return
      tab.loadUrl(resolveOmnibox(a.input, services.settings.get().searchEngine).url)
    }
  }
}
