# BMAX Browser — project memory

Privacy-first desktop browser (Windows primary; macOS/Linux supported). Full brief + approved plan:
`C:\Users\bishw\.claude\plans\quizzical-snacking-hare.md` and `docs/ARCHITECTURE.md`.

## Stack (pinned, exact versions in package.json)
Electron 45 · TypeScript 5.9 strict (TS 7 not used: typescript-eslint supports <6.1) · electron-vite (Vite 8) ·
React 19 + Tailwind 4 · zod 4 for IPC validation · Vitest 5 · Playwright (`_electron`) · npm (no workspaces).
Later phases: @ghostery/adblocker-electron, webtorrent (utilityProcess), electron-builder, electron-updater.

## Layout
- `src/main` — everything privileged (windows, tabs, sessions, net pipeline, privacy, shields, tor, downloads, torrents, vault)
- `src/preload` — `chrome.ts` (browser UI + overlays), `web.ts` (registered on every tab frame: exposes the bmax API only when location is bmax://, otherwise fingerprint protections)
- `src/renderer` — React UIs, one Vite entry each: chrome, overlay, newtab, settings, error, warning, tor, bookmarks
- `src/shared` — types, IPC channel map + zod schemas, pure logic (omnibox parser, url utils). No Electron imports.
- `resources/` — bundled binaries (tor, yt-dlp, ffmpeg), filters, icons; `resources/bin/CHECKSUMS.md` pins hashes
- `tests/unit` (Vitest) · `tests/e2e` (Playwright)

## Conventions / non-negotiables
- Every webContents: `contextIsolation:true, nodeIntegration:false, sandbox:true`. Sandboxed preloads bundle all deps (only `electron` is external).
- Every `ipcMain.handle` goes through `ipc/router.ts`: checks sender role (webContents registry) + zod-parses the payload.
- child_process only with argument arrays (`execFile`/`spawn`, never `exec`/shell strings). ESLint enforces `exec`.
- Electron allows ONE `webRequest` listener per event per session → all request logic is a handler in `net/RequestPipeline.ts`.
- Internal pages use the privileged `bmax://<page>` scheme (prod) / Vite dev server (dev, trusted only in dev). `isInternalUrl()` is the single check.
- Fetch favicons etc. in main through the *tab's own session* (`ses.fetch`) so proxy/Tor/pipeline apply; UI CSP is `img-src data:`.
- No telemetry/network except user loads, filter updates, update checks. Chromium background networking is disabled in `app/flags.ts`.
- Nothing about browsing is written to disk by default. `userData` may hold only settings.json (+ stats counters), plus what the user explicitly creates or opts into: bookmarks.json (plain, no password), vault.bin (passwords), session.json, extensions/, and `persist:` profiles for "Keep me signed in" / extension windows.
- Popups/menus/find bar are separate overlay WebContentsViews (kind via `bmax://overlay/?kind=…`), re-added on top on show.

## Phase progress
- [x] Plan approved
- [x] Phase 0 scaffold; spike (c) main-world injection OK (needs nodeIntegrationInSubFrames:true for iframes); spike (a) titlebar drag/overlay still needs a visual check on an unlocked desktop; spike (b) Ghostery-in-pipeline deferred to the start of Phase 3
- [x] Phase 1 Core browser (18 e2e + 18 unit tests green). Open items: spellcheck dictionary not bundled yet; sites do not get prefers-color-scheme dark (WebContentsView does not track nativeTheme; try CDP Emulation.setEmulatedMedia in Phase 6)
- [x] Phase 2 Privacy engine (47 e2e + 35 unit tests green). Real Tor binary NOT installed yet (see docs/BINARIES.md); e2e uses tests/e2e/fake-tor.cjs. Not yet verified on a real network: DoH providers, real Tor circuits. Known gaps: fingerprint noise does not reach Web Workers; font enumeration only partly mitigated; no password autofill (manual copy only); Tor uses one shared SocksPort (NEWNYM is global); Chromium has no SOCKS-auth stream isolation.
  - Privacy request logic lives in `net/privacy-handlers.ts` (pipeline handlers); per-frame fingerprint config via sync IPC `bmax:web-config` (`privacy/web-config.ts`) → `preload/fingerprint.ts` (stringified, runs in main world).
  - Sessions: `bmax-private` (shared), `bmax-ctr-*` containers, `bmax-iso-*` isolated windows, `bmax-tor-*` Tor windows; ephemeral ones are wiped when their last tab closes (`SessionManager.release`). Burn = `WindowManager.burn()`.
  - New internal pages: warning (HTTPS-Only), tor (bootstrap progress), bookmarks (vault UI).
- [x] Phase 3 Shields (62 e2e + 49 unit green; opt-in `BMAX_NETWORK=1` real-list tests pass except the YouTube ad check, see below)
  - `src/main/shields/`: `ListStore` (download + conditional GET + disk cache), `engine-worker` (compiles lists off-thread via `?nodeWorker`), `ShieldsEngine` (3 engines: custom > trackers > ads), `ShieldsManager` (pipeline handler, cosmetic/scriptlet IPC, per-tab stats, popup/redirect/notification rules, picker, rules, updater), `youtube/` (host match + CSS) and `src/preload/youtube.ts` (in-page ad pruning + auto-skip; self-contained, edit AD_KEYS/AD_RENDERERS when YouTube changes).
  - Ghostery's cosmetic preload is registered per session, but we do NOT call `enableBlockingInSession` (it would steal the webRequest listeners); our own ipcMain handler applies cosmetics (main-frame CSS via insertCSS, scriptlets via the sender frame). Scriptlets are de-duplicated (quick-fixes/unbreak are in both engines).
  - Known: cosmetic/scriptlet injection is asynchronous (IPC round trip), so early page scripts can run first; real YouTube returns an error/bot-check player response to this unsigned client, so ad removal there is verified only on YouTube-shaped test data; the d3ward test page is archived (canyoublockit.com and adblock-tester.com are used instead); first run needs network to download lists (no bundled snapshot); URLhaus list is large (~11 MB).
- [x] Phase 4 Media downloader (see notes below)
  - `src/main/downloads/`: `args.ts` (pure: yt-dlp argv builders, output parsing, media classification), `tools.ts` (binary lookup, userData copy, spawn helpers, taskkill tree), `DownloadManager.ts` (yt-dlp jobs, Electron will-download files, image batches, pause/resume/cancel/retry, probe, yt-dlp -U), `MediaTracker.ts` (network sniffer + DOM scan + image list). UI: address-bar button -> overlay `media` (MediaView), `bmax://downloads` page (Ctrl+J), Settings -> Downloads.
  - yt-dlp 2026.10.26 and ffmpeg 9.0.2 (GPLv3 full build, copied from the dev machine winget install) are in resources/bin (git-ignored; hashes in resources/bin/CHECKSUMS.md). YouTube JS runtime = this app run as Node (ELECTRON_RUN_AS_NODE) via --js-runtimes.
  - Jobs are memory-only; Burn and quit kill running yt-dlp trees. Pause = kill + resume from .part in a per-job temp dir.
  - Known: DASH/HLS only via yt-dlp+ffmpeg (blob:/MSE players are handled through the page URL); yt-dlp uses system DNS (not DoH) unless proxied; first yt-dlp start takes ~5 s (onefile unpack); ffmpeg full build is large and GPLv3 (licence check before shipping); 8K availability depends on the site.
- [x] Phase 5 Torrents (see notes)
  - `src/main/torrents/`: `worker.ts` (webtorrent 3, ESM loaded via dynamic import inside an Electron utilityProcess; bundled with `?modulePath`), `TorrentManager.ts` (process lifecycle, request/reply protocol, guards, dialogs, magnet/.torrent interception). Shared parsing/validation in `src/shared/torrents.ts`. UI: `bmax://torrents` (selection, progress, player; CSP allows media from 127.0.0.1 only on this page), Settings -> Torrents. Tor windows: every torrents.* command and magnet/.torrent handling is refused (`assertAllowed`).
  - webtorrent quirks handled: `torrent.done` means ALL files (we compute "chosen files complete"), pause() only stops new peers (we also drop wires and deselect), NAT/LSD defaults changed to OFF, client-level maxConns/throttles applied at runtime.
  - npm blocked node-datachannel install script (WebRTC peers) - not needed for TCP peers; do not approve it casually. e2e uses TCP-only peers (BMAX_TORRENT_NO_UTP=1; uTP native addon is not usable in the Playwright node process).
  - Known: no resume of partial torrents after restart (memory-only by design); only video/audio formats Chromium can play are streamable in the built-in player (others: open with system player); tracker DNS uses the system resolver; no real-internet swarm test (hermetic local swarm only).
- [x] Phase 6 Settings / extensions / polish / packaging (see notes)
  - Settings sections: General (opt-in session restore, tab sleeping, update checks), Appearance (+ site colour scheme, reader font), Search, Shields, Privacy & Security, Downloads, Torrents, Network, Tor, Extensions, Shortcuts (list generated from `SHORTCUT_DOCS`, unit-tested against `matchShortcut`), About (version, updates). Shared form widgets in `renderer/settings/ui.tsx`.
  - Reader mode: `reader/ReaderManager` (Readability via `?raw`; electron-vite config bundles `@mozilla/readability` instead of externalizing it) → `bmax://reader`. Article HTML is UNTRUSTED: `renderer/reader/sanitize.ts` rebuilds it from an allow-list. Address bar keeps the original URL (like error/warning pages).
  - Tab sleeping: `Tab.sleep()` loads about:blank and remembers the history index; `wake()` does `goToIndex` and removes the placeholder entry. `navigationHistory.restore()` is NOT usable (Electron: only on a webContents that never loaded a page). Lazy tabs (session restore) just `loadUrl` on first select.
  - Session restore: opt-in, `session.json` = addresses only, skips Tor/isolated/container tabs and extension windows; empty state never overwrites the last real one; Burn suppresses + deletes.
  - Site dark mode: CDP `Emulation.setEmulatedMedia` per tab (`Tab.applyColorScheme`), re-applied on theme/setting change; Tor windows always light. PiP: `Tab.togglePictureInPicture` (script with user gesture); PiP tabs are never slept.
  - Extensions: **Electron refuses to load extensions into memory-only sessions**, so they run only in a "window with extensions" (Ctrl+Shift+E, EXT chip) on the persistent partition `persist:bmax-ext` (temporary profile: wiped when its last tab closes and on Burn; folder deleted at start-up). Normal/isolated/container/Tor windows never run extensions. electron-chrome-extensions was NOT used (GPL-3.0/commercial licence conflicts with an unlicensed app). No toolbar buttons; popups/options open in a tab. CRX/zip are unpacked by `extensions/zip.ts` (zip-slip, bomb and CRC checks, unit-tested); CRX signatures are not verified.
  - Updates: `updates/UpdateManager` over electron-updater (partition `electron-updater` carries the proxy setting); unsupported in dev/portable/non-AppImage Linux; flow tested with a fake updater only.
  - Packaging: `electron-builder.yml` (NSIS+portable, dmg+zip, AppImage+deb; signing/notarization are placeholders), `npm run dist:dir` verified on Windows (`tests/e2e/packaged.spec.ts` runs against dist/win-unpacked and skips if absent). Installer (NSIS) build, macOS and Linux builds NOT run. Icons from `npm run icons`. `npm run verify-binaries`. CI: `.github/workflows/ci.yml` (no e2e: needs binaries) and `release.yml` (tag → draft release). Docs: PACKAGING.md, THIRD_PARTY.md (FFmpeg full build is GPLv3: decide before distributing).
  - Perf: first window visible ~0.3 s after process start (`services.metrics.firstWindowMs`, asserted < 2 s in e2e, dev and packaged).
  - Spellcheck: en-US.bdic bundled (resources/dictionaries, Chromium hunspell repo, hash pinned; downloaded once with the user's approval). Other languages: drop `<lang>.bdic` into that folder. Flag `WinUseBrowserSpellChecker` is disabled so only the bundled dictionary is used (negative control: without the file nothing is flagged; test in phase6.spec.ts uses real key events, `insertText` does not trigger spellcheck).
  - Post-phase changes (user request): bookmarks moved OUT of the vault into `bookmarks/BookmarkStore` (plain bookmarks.json, no lock; legacy vault bookmarks migrate on unlock); Chrome-style bookmarks bar (`renderer/chrome/BookmarksBar.tsx`, `showBookmarksBar`, Ctrl+Shift+B; chrome height = `BmaxWindow.chromeHeight()`); opt-in `privacy.keepSiteData` maps `bmax-private` to `persist:bmax-main` at start-up (fixes YouTube's empty home page = no cookies); download button always visible on web pages + media rescans; hidden overlays are destroyed after 45 s (memory); default tab sleep 15 min; app icon generated from `resources/icons/source/logo.webp`.
  - Known: real update flow, DoH providers, real Tor circuits and real-internet torrents unverified; fingerprint noise not in Web Workers.

## Commands
`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e`

## Testing notes
- e2e uses a hermetic local server (tests/e2e/server.ts); drive the browser UI through Playwright pages (chrome/overlays are visible as pages) and the main process through `inMain()` + `globalThis.__bmax` (BMAX_TEST=1).
- Keyboard shortcuts must be tested with `webContents.sendInputEvent` (CDP key events bypass before-input-event).
- Shell gotcha on this machine: avoid backticks/${} inside `node -e` strings in Bash; use the Edit/Write tools for code containing template literals.
