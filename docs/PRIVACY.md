# What BMAX stores and sends

This is the privacy policy of BMAX Browser. It is shown inside the browser (menu → Privacy policy, or `bmax://privacy`) and is kept next to the code in `docs/PRIVACY.md`, so what it says can be checked against what the program does. BMAX has no accounts, no telemetry, no analytics and no crash reporting.

## Stored on disk
| Item | Where | When |
|---|---|---|
| Settings (theme, search engine, home page, shortcut tiles, privacy toggles, DNS/proxy choices) | `settings.json` in the app data folder | always |
| Lifetime counters: ads blocked, trackers blocked, estimated time saved (3 numbers) | `stats.json` | always |
| Per-site permission decisions | `permissions.json` | **only** if "Remember site permission decisions" is on (off by default); turning it off deletes the file |
| Bookmarks (title, address, small site icon) | `bookmarks.json` | **only** once you bookmark a page. Stored as a plain, unencrypted file so they are always available without a password; delete a bookmark to remove it. Burn does not delete bookmarks. |
| Cookies, site data and cache of normal windows | `Partitions/bmax-main/` | **only** if you turn on "Keep me signed in" (off by default; Settings → Privacy & Security). Wiped by Burn and when you turn the setting off; the folder is deleted at the next start while it is off. Never used by Tor, isolated or container tabs. |
| Saved passwords | `vault.bin` | **only** if you create the vault (off by default). AES-256-GCM with a scrypt-derived key from your master password, wrapped again by the OS secure storage (Windows DPAPI / macOS Keychain / Linux keyring). Never uploaded. |
| Tor's working files (consensus, state) | a temporary folder | only while a Tor window is open; deleted when Tor stops |
| The addresses of your open tabs (no titles, cookies or page data) | `session.json` | **only** if "Continue where I left off" is on (off by default). Never contains Tor windows, isolated windows or container tabs. Turning the setting off, or Burn, deletes the file. |
| Extensions you install (their files and an on/off list) | `extensions/` | **only** if you install an extension; remove it in Settings → Extensions to delete its files |
| Cookies, cache and site data of a **window with extensions** | `Partitions/bmax-ext/` | **only** while such a window is open (see Extensions below); wiped when its last tab closes and on Burn, and the folder is deleted at the next start |
| Filter lists, a working copy of yt-dlp | `shields/`, `bin/` | see Shields and Downloads below |

## Never stored
Browsing history, cookies, localStorage, IndexedDB, service workers, HTTP cache, form data, downloads list.
Web content lives in memory-only Electron partitions (no `persist:` prefix) and disappears when the tab/window/app closes (unless you opted in to "Keep me signed in", see the table above; signed-out sites such as YouTube show an empty home page until then, because they see a brand-new visitor every time).
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

## Shields (ad / tracker blocking)
- Blocking happens locally with the Ghostery adblocker engine; no browsing data is sent anywhere. Per-tab counters live in memory and
  reset on every page load. Only three lifetime numbers are stored (see above). Sites where you turned Shields off are stored by
  registrable domain in `settings.json` (your choice, listed in Settings → Shields).
- **Filter-list downloads are the only network traffic Shields makes** (every 12 hours, and at startup if stale; switch off in
  Settings → Shields → "Update lists automatically"). They are plain downloads without cookies or referrer, through the same proxy
  setting as normal windows, from: easylist.to, ublockorigin.github.io, pgl.yoyo.org, filters.adtidy.org, secure.fanboy.co.nz,
  curbengh.github.io (malware-filter, a mirror of abuse.ch URLhaus), raw.githubusercontent.com (uBlock scriptlet resources via the
  Ghostery repository) and, only if you enable regional lists, easylist-downloads.adblockplus.org. Lists and the compiled engine are cached in
  `userData/shields/` (filter data only). Your custom rules are stored in `userData/shields/custom-rules.txt`.
- Pop-ups, automatic redirects and notification prompts are decided locally from whether you recently clicked or typed.

## Downloads
- The downloads list lives in memory only: it disappears when BMAX closes or you press Burn, and nothing about your downloads is
  stored. The files you download stay in your download folder (Settings → Downloads). Partial files are kept in a temporary
  folder and deleted when a download finishes or is cancelled.
- Video/audio downloads run the bundled **yt-dlp** and **ffmpeg** as separate programs (arguments are passed as a list, never through a
  shell). yt-dlp contacts the site you are downloading from (and, for some sites, that site's own helper servers) in the same way
  your browser would; it uses no cookies, no cache and ignores any yt-dlp config file. Name lookups made by yt-dlp use the system
  resolver, not BMAX's DNS-over-HTTPS setting (unless you use a proxy or Tor, which resolve names remotely).
- In a **Tor window** downloads go through Tor (`socks5h`, remote DNS) and are refused until Tor is connected. With a proxy set in
  Settings → Network, downloads use that proxy too.
- **yt-dlp updates itself** (`yt-dlp -U`, about once a day, switchable in Settings → Downloads): a request to GitHub; yt-dlp verifies
  the update. A working copy of yt-dlp lives in the app data folder (`bin/`) so it can be updated.
- Media detection looks at the page in memory (number of `<video>`/`<audio>`/images and media files seen on the network); nothing
  is recorded.

## Torrents
- **Torrent traffic is NOT private.** It never goes through Tor, ignores the proxy configured in Settings → Network, and is not
  protected by BMAX's DNS-over-HTTPS setting. Every peer and tracker can see your real IP address and which torrents you share.
  BMAX shows this warning at the top of the torrent manager, in Settings → Torrents, and in a confirmation dialog the first time
  you add a torrent after each start (and after Burn). Use an operating-system VPN if you need to hide your address.
- **Torrents are completely disabled in Tor windows**: the page, every command, magnet links and `.torrent` downloads are refused
  there and the torrent engine is never started for them.
- The engine runs in its own sandboxed utility process, never in a web page. By default UPnP/NAT-PMP port mapping and LAN
  peer discovery are OFF (both are opt-in in Settings → Torrents); the DHT is on because magnet links need it.
- The torrent list lives in memory only and sharing stops when BMAX closes or you press Burn; the files you downloaded stay in
  the download folder (default: Downloads/Torrents). Streaming uses a loopback-only server (127.0.0.1) protected by a random
  per-session token and a Host-header check.
- Torrent metadata is untrusted: torrents whose file paths could escape the download folder are rejected.

## Spell-check
Spell-check uses an English (en-US) dictionary that ships inside BMAX and runs entirely on your computer. Nothing you type is sent anywhere, and BMAX never downloads dictionaries (the operating system's own spell-checker is switched off so only the bundled dictionary is used).

## Reader mode
Reader mode extracts the article from the page you are looking at, in your own browser (Mozilla Readability), and shows it on an internal
page. The article text is kept in memory only, for the tabs that need it, and is cleared by Burn. Nothing is sent anywhere. Because a web
page can influence the extracted text, BMAX rebuilds it from an allow-list of safe elements before showing it (no scripts, frames, forms,
styles or event handlers). Images in the article load like images on the original page: through the same session, so Shields, your proxy
or Tor apply, and without a referrer. The font, size and colour you choose are saved in `settings.json`.

## Tab sleeping and picture-in-picture
Background tabs that have been idle for the time you choose (default 30 minutes; Settings → General) are unloaded from memory and reload
when you select them. This happens only on your computer. Tabs that play audio, show picture-in-picture, are loading or have developer tools
open are never put to sleep. Picture-in-picture uses the browser's built-in floating video window; it makes no network request of its own.

## Dark mode for websites
By default BMAX tells websites whether you prefer a light or dark colour scheme according to the theme you chose for the browser. This is one
more piece of information a site could use to recognise you, so you can choose "Always tell sites I prefer light" in Settings → Appearance
to give every site the same answer. Tor windows always report light.

## Extensions
- Extensions are **off until you install one**. BMAX has no extension store: you load a folder or a .crx/.zip file yourself, after seeing what
  it can access. BMAX does not verify who published a package.
- Extensions run **only in a "window with extensions"** (Ctrl+Shift+E, marked EXT in the toolbar), never in normal windows, Tor windows, isolated
  windows or container tabs. An extension can see and change the pages it runs on and can make network requests of its own; only install
  extensions you trust.
- **Why a separate window, and what it costs your privacy:** Electron can only run extensions in a browsing session that is stored on disk, while
  every normal BMAX window keeps cookies, cache and site data in memory only. A window with extensions therefore uses a *temporary profile*: while
  it is open, its cookies, cache and site data are written to `Partitions/bmax-ext/` in the app data folder. They are wiped when its last tab closes
  and on Burn, and the whole folder is deleted the next time BMAX starts (so a crash cannot leave them behind for long). If you never open a window
  with extensions, this folder is never used. Your normal windows are not affected.
- Burn clears extension data but does not uninstall extensions.

## Updates
- Once a day (and at start-up), unless you turn it off in Settings → General, BMAX asks GitHub Releases whether a newer version exists. This
  reveals your IP address, the BMAX version and your operating system to GitHub, like any download. The request uses your proxy setting and
  never uses Tor. Nothing is downloaded or installed until you click Download / Restart and install in Settings → About; update packages
  are checked by electron-updater (and, for signed builds, by the publisher name).
- The portable Windows build and development builds do not update themselves.
