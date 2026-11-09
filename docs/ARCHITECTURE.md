# BMAX Browser — architecture (as built through Phase 1)

```
Main process (src/main)
 ├─ index.ts            bootstrap: flags, single instance, services, IPC, first window
 ├─ windows/            WindowManager → BmaxWindow (BaseWindow) → OverlayManager
 ├─ tabs/               Tab (WebContentsView), context menu, favicon fetch, zoom store
 ├─ sessions/           SessionManager: memory-only partitions (no "persist:" prefix)
 ├─ net/                RequestPipeline (the ONE webRequest listener per session), CertCache
 ├─ permissions/        PermissionManager (ask / deny-all, per-site memory)
 ├─ settings/           SettingsStore + StatsStore (JSON in userData; settings and 3 counters only)
 ├─ ipc/                router (role check + zod parse) + handlers
 ├─ privacy/            spellcheck (loopback dictionary server)
 └─ app/                flags, internal-pages (bmax:// protocol + CSP), registry, external-protocol confirm

Per BaseWindow (children, bottom → top)
  tab view (active tab only)  ·  chrome view (bmax://chrome, 84 px)  ·  overlay views (menu, cert, permission, find, suggest)
```

## Trust levels
| webContents | session | preload | IPC role |
|---|---|---|---|
| chrome view, overlays | `bmax-ui` (all network blocked except bmax://) | `chrome.js` | `chrome` / `overlay` |
| tab showing `bmax://newtab|settings|error` | tab session | `web.js` exposes `window.bmax` only when `location.protocol === 'bmax:'` | `page` |
| tab showing a website | tab session (`bmax-private`, or an isolated `bmax-iso-*`) | `web.js` (no API; privacy hardening only) | none |

Roles are derived in `ipc/router.ts` from the main-process registry **and** the sender frame's real URL, never from anything the
renderer claims. Each command declares its allowed roles in `src/shared/ipc.ts`.

## Navigation rules (Tab.ts)
- Websites cannot navigate to or frame `bmax://` pages; internal pages cannot navigate away on their own (main does it via `page.navigate`).
- Non-browser schemes (`mailto:`, `magnet:` …) are blocked and, for the main frame, offered to the user via a confirmation dialog.
- `window.open` / `target=_blank` open a new tab; internal pages get no popups.

## Key decisions
- Overlays are separate transparent `WebContentsView`s sized to their content (`overlay.resize`) so nothing invisible swallows clicks.
- Favicons are fetched in main through the tab's own session and passed as `data:` URLs (UI CSP: `img-src data:`).
- Theme: internal pages follow main's resolved theme via `theme.get` + push (Chromium's `prefers-color-scheme` does not track
  `nativeTheme` for WebContentsViews).
- Shortcuts are matched in `before-input-event` (pure function in `src/shared/shortcuts.ts`, unit-tested), so they work with focus anywhere.
- The e2e harness exposes services on `globalThis.__bmax` only when `BMAX_TEST=1`.
