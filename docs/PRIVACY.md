# What BMAX stores and sends (status after Phase 1)

This page is a draft of the privacy policy; it is updated in every phase and finalised in Phase 6.

## Stored on disk
| Item | Where | When |
|---|---|---|
| Settings (theme, search engine, home page, new-tab shortcut tiles, permission policy) | `settings.json` in the app data folder | always |
| Lifetime counters: ads blocked, trackers blocked, estimated time saved (3 numbers) | `stats.json` | always |
| Per-site permission decisions | `permissions.json` | **only** if "Remember site permission decisions" is turned on (off by default); turning it off deletes the file |

## Never stored
Browsing history, cookies, localStorage, IndexedDB, service workers, HTTP cache, form data, passwords, downloads list.
Web content lives in memory-only Electron partitions (no `persist:` prefix) and disappears when the tab/window/app closes.
Closed-tab history (Ctrl+Shift+T) and per-site zoom are kept in memory only.

Verified by an automated test (`browsing leaves no traces of visited sites on disk`): it writes localStorage, a cookie and an
IndexedDB database on a visited site and scans every file in the app data folder for the site's port, page titles and those values.

Note: Chromium creates its own empty profile scaffolding in the app data folder (cache/Local Storage directory structures,
`Preferences`, `Local State`, …). They receive no web content; the test above checks that.

## Network
BMAX contacts only the sites you open. There is no telemetry, analytics or crash reporting, and Chromium's background
networking (component updater, domain reliability, hyperlink-audit pings, sync, …) is switched off. The browser UI itself
cannot load anything from the network. Spellcheck dictionaries are bundled (no download); filter-list and update checks arrive in later phases.
