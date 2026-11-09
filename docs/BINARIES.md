# Bundled third-party binaries

BMAX never downloads or runs a binary that has not been verified. Binaries live in `resources/bin/<name>/<platform>-<arch>/`
and are git-ignored; `resources/bin/CHECKSUMS.md` pins the expected SHA-256 of every file we ship.

## Tor (Phase 2) — installed: Tor 0.4.9.15 from Tor Expert Bundle 16.0 (windows-x86_64)
BMAX looks for `resources/bin/tor/<platform>-<arch>/tor/tor(.exe)` (e.g. `win32-x64`) with the bundle's `data/geoip*` next to the `tor/` folder: extract the official archive as-is into `resources/bin/tor/<platform>-<arch>/`. Without it, Tor windows open, explain that
Tor is missing, and stay fail-closed (nothing loads, nothing leaves the machine).

Official source: **Tor Expert Bundle** from <https://www.torproject.org/download/tor/> (files are served from
<https://dist.torproject.org/torbrowser/>). Verify before use:
1. Download the bundle for your platform plus `sha256sums-signed-build.txt` and its `.asc` signature from the same release directory.
2. Verify the signature with GnuPG against the Tor Browser Developers signing key (fingerprint published at
   <https://support.torproject.org/tbb/how-to-verify-signature/>): `gpg --verify sha256sums-signed-build.txt.asc`.
3. Check that the SHA-256 of the bundle matches the signed list, then record it in `resources/bin/CHECKSUMS.md`.
4. Extract the archive into `resources/bin/tor/<platform>-<arch>/`.

Verified for 16.0 (win32-x64): signature on `sha256sums-signed-build.txt` and on the bundle are both good, made by subkey 022DA248432D2A0E0F54E65E316C1FACD62D07D9 of primary key EF6E286DDA85EA2A4BA7DE684E2C6E8793298290 (the fingerprint published on support.torproject.org), and the bundle SHA-256 matches the signed list. Binaries are git-ignored; each machine/CI job repeats the download and verification.

## yt-dlp, ffmpeg (Phase 4)
Sources and verification steps will be added here before anything is downloaded.

## Spellcheck dictionaries
`resources/dictionaries/<lang>.bdic` (e.g. `en-US.bdic`). BMAX serves them to Chromium from a loopback-only server so Electron never
contacts Google's dictionary CDN. Without a file, spellcheck stays off.
