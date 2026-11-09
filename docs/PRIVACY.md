# What BMAX stores and sends (status after Phase 2)

This page is a draft of the privacy policy; it is updated in every phase and finalised in Phase 6.

## Stored on disk
| Item | Where | When |
|---|---|---|
| Settings (theme, search engine, home page, shortcut tiles, privacy toggles, DNS/proxy choices) | `settings.json` in the app data folder | always |
| Lifetime counters: ads blocked, trackers blocked, estimated time saved (3 numbers) | `stats.json` | always |
| Per-site permission decisions | `permissions.json` | **only** if "Remember site permission decisions" is on (off by default); turning it off deletes the file |
| Bookmarks and saved passwords | `vault.bin` | **only** if you create the vault (off by default). AES-256-GCM with a scrypt-derived key from your master password, wrapped again by the OS secure storage (Windows DPAPI / macOS Keychain / Linux keyring). Never uploaded. |
| Tor's working files (consensus, state) | a temporary folder | only while a Tor window is open; deleted when Tor stops |

## Never stored
Browsing history, cookies, localStorage, IndexedDB, service workers, HTTP cache, form data, downloads list.
Web content lives in memory-only Electron partitions (no `persist:` prefix) and disappears when the tab/window/app closes.
Container tabs, isolated windows and Tor windows get their own partitions, wiped when their last tab closes.
**Burn** wipes every partition (cookies, storage, cache, auth, DNS cache), forgets permissions, zoom and closed tabs, locks the
vault and closes all windows. Closed-tab history (Ctrl+Shift+T) and per-site zoom are kept in memory only.

Verified by automated tests: browsing + localStorage + cookie + IndexedDB leave no trace in the app data folder; the vault file
contains no plaintext; Burn leaves one fresh window with no site data.

Chromium creates its own empty profile scaffolding in the app data folder (cache/Local Storage directory structures,
`Preferences`, `Local State`, …). They receive no web content.

## What is sent to websites
- One uniform `User-Agent` (generic Chrome on Windows, major version only), minimal client hints, `Accept-Language: en-US,en`.
- `Sec-GPC: 1` (Global Privacy Control). Never `DNT`.
- Cross-site referrers are cut to the origin (never sent on HTTPS→HTTP). Tracking parameters (`utm_*`, `fbclid`, `gclid`, `mc_eid`,
  `igshid`, …) are removed from addresses you open.
- Third-party cookies are blocked (request and response headers, and `document.cookie` in third-party frames); third-party
  `sendBeacon`/ping requests are blocked.
- Per-site fingerprint noise for canvas, WebGL and audio; fixed `hardwareConcurrency`, `deviceMemory`, platform and language; no
  Battery or Network Information API.
- WebRTC only uses proxied connections (`disable_non_proxied_udp`) so it cannot reveal your IP address.

## Network
BMAX contacts only the sites you open, plus your chosen DNS-over-HTTPS provider (Quad9 by default) for name lookups. There is no
telemetry, analytics or crash reporting, and Chromium's background networking (component updater, domain reliability,
hyperlink-audit pings, sync, …) is off. The browser UI itself cannot load anything from the network. Filter-list and update checks
arrive in later phases and can be disabled.

## Tor windows
Everything in a Tor window goes through a Tor SOCKS5 proxy on `127.0.0.1`; name lookups happen inside Tor. Until Tor reports 100%
bootstrapped, every request is blocked. Local-network addresses are blocked. HTTPS is forced (except `.onion`), WebRTC is removed,
all permission requests are denied. This hides your IP address; it does **not** make the browser indistinguishable from other Tor
Browser users (use the official Tor Browser for that).
