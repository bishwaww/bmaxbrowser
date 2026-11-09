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
