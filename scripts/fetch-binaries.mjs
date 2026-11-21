// Downloads the bundled third-party tools for a Windows x64 build and refuses anything whose SHA-256 is not the one pinned
// in resources/bin/CHECKSUMS.md. Used by the release workflow (the binaries are not in git); also works on a new dev machine.
//   node scripts/fetch-binaries.mjs            fetch what is missing
//   node scripts/fetch-binaries.mjs --force    fetch everything again
// Sources (the same ones recorded in CHECKSUMS.md / docs/BINARIES.md):
//   yt-dlp  github.com/yt-dlp/yt-dlp releases          (the .exe itself is pinned)
//   ffmpeg  github.com/GyanD/codexffmpeg releases      (gyan.dev's official mirror; ffmpeg.exe and ffprobe.exe are pinned)
//   Tor     archive.torproject.org Tor Expert Bundle   (the archive is pinned, and tor.exe inside it)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin')
const force = process.argv.includes('--force')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('fetch-binaries: only Windows x64 binaries are pinned; nothing to do on this platform.')
  process.exit(0)
}

/** sha256 by file name, read from CHECKSUMS.md (the single place where hashes are pinned). */
const pinned = new Map()
for (const line of readFileSync(join(root, 'CHECKSUMS.md'), 'utf8').split(/\r?\n/)) {
  const m = /^([0-9a-f]{64})\s{2}(\S+)/.exec(line)
  if (m) pinned.set(m[2], m[1])
}
const pin = (name) => {
  const h = pinned.get(name)
  if (!h) throw new Error(`No pinned SHA-256 for ${name} in CHECKSUMS.md`)
  return h
}
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const check = (file, name) => {
  const actual = sha256(file)
  if (actual !== pin(name)) throw new Error(`SHA-256 mismatch for ${name}\n  expected ${pin(name)}\n  actual   ${actual}`)
  console.log(`verified  ${name}`)
}
const good = (file, name) => existsSync(file) && sha256(file) === pin(name)

async function download(url, dest) {
  console.log(`download  ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) ${url}`)
  mkdirSync(dirname(dest), { recursive: true })
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

// Windows ships bsdtar, which reads both .zip and .tar.gz. (Use it by full path: Git's GNU tar cannot read zip files.)
const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const extract = (archive, dir) => {
  mkdirSync(dir, { recursive: true })
  execFileSync(TAR, ['-xf', archive, '-C', dir], { stdio: 'inherit' })
}

const tmp = mkdtempSync(join(tmpdir(), 'bmax-bin-'))
try {
  // ---- yt-dlp
  const ytDir = join(root, 'yt-dlp', 'win32-x64')
  const yt = join(ytDir, 'yt-dlp.exe')
  if (force || !good(yt, 'yt-dlp/win32-x64/yt-dlp.exe')) {
    const part = join(tmp, 'yt-dlp.exe')
    await download('https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe', part)
    check(part, 'yt-dlp/win32-x64/yt-dlp.exe')
    mkdirSync(ytDir, { recursive: true })
    copyFileSync(part, yt)
  } else console.log('present   yt-dlp')

  // ---- ffmpeg + ffprobe
  const ffDir = join(root, 'ffmpeg', 'win32-x64')
  const ffNames = ['ffmpeg.exe', 'ffprobe.exe']
  if (force || !ffNames.every((n) => good(join(ffDir, n), `ffmpeg/win32-x64/${n}`))) {
    const zip = join(tmp, 'ffmpeg.zip')
    await download('https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-full_build.zip', zip)
    const out = join(tmp, 'ffmpeg')
    extract(zip, out)
    mkdirSync(ffDir, { recursive: true })
    for (const n of ffNames) {
      const src = join(out, 'ffmpeg-9.0.2-full_build', 'bin', n)
      check(src, `ffmpeg/win32-x64/${n}`)
      copyFileSync(src, join(ffDir, n))
    }
  } else console.log('present   ffmpeg')

  // ---- Tor
  const torDir = join(root, 'tor', 'win32-x64')
  if (force || !good(join(torDir, 'tor', 'tor.exe'), 'tor/tor.exe')) {
    const name = 'tor-expert-bundle-windows-x86_64-16.0.tar.gz'
    const tgz = join(tmp, name)
    await download(`https://archive.torproject.org/tor-package-archive/torbrowser/16.0/${name}`, tgz)
    check(tgz, name)
    const out = join(tmp, 'tor')
    extract(tgz, out)
    check(join(out, 'tor', 'tor.exe'), 'tor/tor.exe')
    rmSync(torDir, { recursive: true, force: true })
    cpSync(out, torDir, { recursive: true })
  } else console.log('present   tor')

  console.log('\nAll bundled binaries are present and match their pinned hashes.')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
