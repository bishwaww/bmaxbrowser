// Checks the bundled third-party binaries against the SHA-256 values pinned in resources/bin/CHECKSUMS.md.
//   node scripts/verify-binaries.mjs            report; exit 1 only on a MISMATCH
//   node scripts/verify-binaries.mjs --strict   also exit 1 when a pinned file is missing
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin')
const strict = process.argv.includes('--strict')
const lines = readFileSync(join(root, 'CHECKSUMS.md'), 'utf8').split(/\r?\n/)

let ok = 0
let missing = 0
let bad = 0
for (const line of lines) {
  const m = /^([0-9a-f]{64})\s{2}(\S+)/.exec(line)
  if (!m) continue
  const [, expected, rel] = m
  if (/\.(tar\.gz|zip)$/.test(rel)) continue // archives are not kept on disk
  const parts = rel.split('/')
  // CHECKSUMS lists the Tor binary as tor/tor.exe (inside tor/win32-x64/).
  const candidates = [join(root, ...parts), join(root, parts[0], 'win32-x64', ...parts)]
  const file = candidates.find((c) => existsSync(c))
  if (!file) {
    missing++
    console.log(`missing   ${rel}`)
    continue
  }
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (actual === expected) {
    ok++
    console.log(`ok        ${rel}`)
  } else {
    bad++
    console.log(`MISMATCH  ${rel}\n          expected ${expected}\n          actual   ${actual}`)
  }
}
console.log(`\n${ok} verified, ${missing} not present, ${bad} mismatched`)
if (bad > 0 || (strict && missing > 0)) process.exit(1)
