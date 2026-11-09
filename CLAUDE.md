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
- Nothing about browsing is written to disk by default. `userData` may hold only settings.json (+ stats counters).
- Popups/menus/find bar are separate overlay WebContentsViews (kind via `bmax://overlay/?kind=…`), re-added on top on show.

## Phase progress
- [x] Plan approved
- [x] Phase 0 scaffold; spike (c) main-world injection OK (needs nodeIntegrationInSubFrames:true for iframes); spike (a) titlebar drag/overlay still needs a visual check on an unlocked desktop; spike (b) Ghostery-in-pipeline deferred to the start of Phase 3
- [x] Phase 1 Core browser (18 e2e + 18 unit tests green). Open items: spellcheck dictionary not bundled yet; sites do not get prefers-color-scheme dark (WebContentsView does not track nativeTheme; try CDP Emulation.setEmulatedMedia in Phase 6)
- [x] Phase 2 Privacy engine (47 e2e + 35 unit tests green). Real Tor binary NOT installed yet (see docs/BINARIES.md); e2e uses tests/e2e/fake-tor.cjs. Not yet verified on a real network: DoH providers, real Tor circuits. Known gaps: fingerprint noise does not reach Web Workers; font enumeration only partly mitigated; no password autofill (manual copy only); Tor uses one shared SocksPort (NEWNYM is global); Chromium has no SOCKS-auth stream isolation.
  - Privacy request logic lives in `net/privacy-handlers.ts` (pipeline handlers); per-frame fingerprint config via sync IPC `bmax:web-config` (`privacy/web-config.ts`) → `preload/fingerprint.ts` (stringified, runs in main world).
  - Sessions: `bmax-private` (shared), `bmax-ctr-*` containers, `bmax-iso-*` isolated windows, `bmax-tor-*` Tor windows; ephemeral ones are wiped when their last tab closes (`SessionManager.release`). Burn = `WindowManager.burn()`.
  - New internal pages: warning (HTTPS-Only), tor (bootstrap progress), bookmarks (vault UI).
- [ ] Phase 3 Shields
- [ ] Phase 4 Media downloader
- [ ] Phase 5 Torrents
- [ ] Phase 6 Settings/extensions/polish/packaging

## Commands
`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e`

## Testing notes
- e2e uses a hermetic local server (tests/e2e/server.ts); drive the browser UI through Playwright pages (chrome/overlays are visible as pages) and the main process through `inMain()` + `globalThis.__bmax` (BMAX_TEST=1).
- Keyboard shortcuts must be tested with `webContents.sendInputEvent` (CDP key events bypass before-input-event).
- Shell gotcha on this machine: avoid backticks/${} inside `node -e` strings in Bash; use the Edit/Write tools for code containing template literals.
