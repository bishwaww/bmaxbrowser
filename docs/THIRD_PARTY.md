# Third-party software in BMAX Browser

BMAX itself is currently **UNLICENSED** (all rights reserved by its author; choose a licence before publishing a release).
It is built on the open-source components below. This list is for information and is not legal advice: check the licence texts
shipped with each component (in `node_modules/<package>/LICENSE`, and inside the installed app's `LICENSES.chromium.html` for Chromium).

## Libraries compiled into the app
| Component | Licence | Used for |
|---|---|---|
| Electron / Chromium / Node.js | MIT + Chromium's BSD-style and other licences (`LICENSES.chromium.html`) | the browser engine and shell |
| React, ReactDOM | MIT | user interface |
| Tailwind CSS | MIT | user interface styling |
| zod | MIT | validation of every IPC message |
| tldts | MIT | registrable-domain (site) detection |
| @ghostery/adblocker-electron (+ preload) | **MPL-2.0** (file-level copyleft: changes to those files must be shared) | ad / tracker blocking engine |
| WebTorrent (and its dependencies) | MIT (dependencies: MIT/ISC/BSD) | built-in torrent client |
| @mozilla/readability | Apache-2.0 | reader mode article extraction |
| electron-updater | MIT | updates from GitHub Releases |

Build tools (not shipped): electron-builder, electron-vite, Vite, TypeScript, ESLint, Prettier, Vitest, Playwright (MIT / Apache-2.0).

## Programs bundled next to the app (`resources/bin`, hashes pinned in `resources/bin/CHECKSUMS.md`)
| Program | Licence | Notes |
|---|---|---|
| Tor (Tor Expert Bundle) | BSD-3-Clause (bundle also contains OpenSSL, libevent, zlib under their own licences) | Tor windows. Source: torproject.org |
| yt-dlp | Unlicense (public domain) | media downloads. Source: github.com/yt-dlp/yt-dlp |
| FFmpeg | **GPLv3** for the "full" build currently bundled (gyan.dev) | merging/converting media. See below |

### FFmpeg and the GPL: decide before you distribute
The FFmpeg build used during development is the gyan.dev **full** build, which is licensed under **GPLv3** and is about 430 MB. BMAX
runs it as a separate program (it is never linked into BMAX), which is the usual way to combine GPL tools with non-GPL software, but
distributing it still requires you to: ship the GPL licence text and a written offer for / link to the corresponding source, and keep
the notices. Options before a public release:
1. Bundle an **LGPL** or "essentials" FFmpeg build instead (smaller, about 90 MB; check which codecs your features need), or
2. keep the GPLv3 build, include its licence and source offer in the installer, and have the licence question reviewed, or
3. do not bundle FFmpeg at all and let the downloader ask the user to install it (the downloader already reports "not installed").

## Filter lists (downloaded at run time, not bundled)
Shields downloads EasyList / EasyPrivacy (GPLv3 / CC BY-SA), uBlock Origin filter lists (GPLv3), Peter Lowe's list, AdGuard lists (GPLv3),
Fanboy lists (GPLv3 / CC BY-SA) and the URLhaus malware-filter mirror (CC0) from their publishers on the user's machine. They are cached
locally and never redistributed by BMAX.
