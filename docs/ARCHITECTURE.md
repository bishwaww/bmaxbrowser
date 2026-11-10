# BMAX Browser — architecture (as built through Phase 6)

The first half describes the Phase 1 core; "Phases 2–6" at the end lists what was added on top. A diagram is in the README.

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

## Phases 2–6: what was added
Main-process modules (all created in `src/main/index.ts`, reachable through `services.*`):
| Module | Role |
|---|---|
| `net/privacy-handlers.ts`, `net/doh.ts` | HTTPS-Only, tracking-parameter stripping, referrer/UA/GPC headers, third-party cookie blocking, DNS-over-HTTPS (handlers run inside the single `RequestPipeline`) |
| `privacy/web-config.ts` + `preload/fingerprint.ts` | per-frame fingerprint configuration, executed in the page's main world |
| `tor/TorManager.ts` | argv-spawned Tor, bootstrap parsing, control-port NEWNYM, fail-closed gate |
| `vault/Vault.ts` | optional encrypted bookmarks/passwords (scrypt + AES-256-GCM + OS secure storage) |
| `shields/` | filter-list store, compiled engine in a worker thread, per-tab stats, popup/redirect rules, element picker, YouTube module |
| `downloads/` | yt-dlp / ffmpeg argv builders, jobs, media sniffer |
| `torrents/` | WebTorrent in an Electron utility process, loopback streaming server |
| `reader/ReaderManager.ts` | Mozilla Readability injected into the page; result kept in memory and shown on `bmax://reader` after allow-list sanitizing (`renderer/reader/sanitize.ts`) |
| `tabs/TabSleeper.ts` + `Tab.sleep()/wake()` | unload idle background tabs (about:blank placeholder), wake by stepping back through navigation history |
| `session/SessionRestore.ts` | opt-in `session.json` (addresses only); never Tor / isolated / container tabs; deleted when disabled or on Burn |
| `extensions/` | install (folder, CRX, zip) with defensive unzip, Electron extension loader; runs only in the **extension window** |
| `updates/UpdateManager.ts` | electron-updater wrapper (check → download → install only on user action) |

### Sessions and windows
`bmax-private` (shared, memory) · `bmax-ctr-*` containers, `bmax-iso-*` isolated windows, `bmax-tor-*` Tor windows (memory, wiped when their last tab closes) ·
`bmax-ui` (internal UI, network blocked) · `bmax-updates` / `electron-updater` (own downloads; proxy setting applies) ·
**`persist:bmax-ext`** — the one *persistent* partition, used only by "windows with extensions" because Electron cannot load extensions into memory-only
sessions. It is a temporary profile: wiped when its last tab closes and on Burn, folder deleted at the next start.

### Internal pages
`newtab, settings, error, warning, tor, bookmarks, downloads, torrents, reader, privacy` (+ `chrome`, `overlay` UIs), served over the privileged `bmax://` scheme with a
strict CSP (`cspFor(page)`: media from loopback only on `torrents`, remote images only on `reader`). `bmax://privacy` renders `docs/PRIVACY.md` at build time.

### Other decisions
- **prefers-color-scheme** for websites is set per tab with the DevTools protocol (`Emulation.setEmulatedMedia`); follows the theme unless the user chose light/dark; Tor windows always say light.
- **Picture-in-picture** runs a small script in the frame that holds the best video (`requestPictureInPicture` with a user gesture); tabs showing PiP are never slept.
- **Tab sleeping** cannot use `navigationHistory.restore()` (Electron only allows it on a webContents that has never loaded a page), hence the about:blank placeholder.
- **Packaging**: electron-builder, asar with `**/*.node` unpacked, third-party binaries as `extraResources` (`resources/bin/**`), publish config → GitHub Releases.
- **Performance**: first window visible about 0.3 s after process start (measured in dev and in the packaged app; budget 2 s). Tor, the torrent engine, yt-dlp and the
  extension profile start lazily; filter lists load after the first window.
