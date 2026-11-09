# Bundled third-party binaries

BMAX never downloads or runs a binary that has not been verified. Binaries live in `resources/bin/<name>/<platform>-<arch>/`
and are git-ignored; `resources/bin/CHECKSUMS.md` pins the expected SHA-256 of every file we ship.

## Tor (Phase 2) — NOT installed yet
BMAX looks for `resources/bin/tor/<platform>-<arch>/tor(.exe)` (e.g. `win32-x64`). Without it, Tor windows open, explain that
Tor is missing, and stay fail-closed (nothing loads, nothing leaves the machine).

Official source: **Tor Expert Bundle** from <https://www.torproject.org/download/tor/> (files are served from
<https://dist.torproject.org/torbrowser/>). Verify before use:
1. Download the bundle for your platform plus `sha256sums-signed-build.txt` and its `.asc` signature from the same release directory.
2. Verify the signature with GnuPG against the Tor Browser Developers signing key (fingerprint published at
   <https://support.torproject.org/tbb/how-to-verify-signature/>): `gpg --verify sha256sums-signed-build.txt.asc`.
3. Check that the SHA-256 of the bundle matches the signed list, then record it in `resources/bin/CHECKSUMS.md`.
4. Extract `tor/` (the `tor` executable and the `data/` folder with `geoip`, `geoip6`) into `resources/bin/tor/<platform>-<arch>/`.

## yt-dlp, ffmpeg (Phase 4)
Sources and verification steps will be added here before anything is downloaded.

## Spellcheck dictionaries
`resources/dictionaries/<lang>.bdic` (e.g. `en-US.bdic`). BMAX serves them to Chromium from a loopback-only server so Electron never
contacts Google's dictionary CDN. Without a file, spellcheck stays off.
