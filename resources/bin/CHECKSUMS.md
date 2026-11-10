# Pinned checksums for bundled binaries

Format: `sha256  file  source  verification`

## Tor (win32-x64), Tor Expert Bundle 16.0, tor 0.4.9.15
```
2ee123e9167318a3742778ff704e75f01d4780f05a14522d451fe011011077c4  tor-expert-bundle-windows-x86_64-16.0.tar.gz
  https://dist.torproject.org/torbrowser/16.0/tor-expert-bundle-windows-x86_64-16.0.tar.gz
  GPG: good signature on the file and on sha256sums-signed-build.txt (primary key EF6E286DDA85EA2A4BA7DE684E2C6E8793298290, signing subkey 022DA248432D2A0E0F54E65E316C1FACD62D07D9); SHA-256 matches the signed list.
1607d98f5d13859077b1b349c55beba76b09acc788f0431fd824d11966fb1074  tor/tor.exe   (extracted from the archive above)
```

## Spell-check dictionary en-US (all platforms), Chromium hunspell_dictionaries en-US-10-2.bdic
```
b0d80e6b6c5491879365e176ecbd98074602a663429bcfcfb0a5a8375c051f13  ../dictionaries/en-US.bdic
  https://chromium.googlesource.com/chromium/deps/hunspell_dictionaries/+/refs/heads/main/en-US-10-2.bdic
  Integrity: the git blob id of the downloaded bytes (fb4bae636596c1179ce78121a35382b414525516) equals the one in the repository listing. No publisher signature exists for it.
  Downloaded once by the developer (with approval) over HTTPS from Chromium's own repository, not Google's dictionary CDN; BMAX never fetches dictionaries at run time.
```

## yt-dlp (win32-x64), release 2026.10.26
```
f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d  yt-dlp/win32-x64/yt-dlp.exe
  https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe
  GPG: good signature on SHA2-256SUMS (key AC0CBBE6848D6A873464AF4E57CF65933B5A7581, "yt-dlp signing key", from the project's public.key;
  fingerprint also served by keys.openpgp.org); SHA-256 matches the signed list.
```

## ffmpeg 9.0.2 full build (win32-x64), gyan.dev — copied from the machine's winget install, NOT re-downloaded
```
589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0  ffmpeg/win32-x64/ffmpeg.exe
02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3  ffmpeg/win32-x64/ffprobe.exe
  Source: Gyan.FFmpeg (winget) ffmpeg-9.0.2-full_build — the Windows builds linked from ffmpeg.org. GPLv3 build (see its LICENSE).
  Provenance rests on winget's manifest hash check of the original archive; to re-verify, compare with the SHA-256 published next to
  https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-full_build.zip.
```
