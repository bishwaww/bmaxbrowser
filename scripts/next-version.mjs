// Picks the version number for the next published build (used by .github/workflows/release.yml).
// package.json supplies MAJOR.MINOR (and the lowest patch number); every release after that gets the next free patch number,
// so each push to main becomes a new, higher version that installed copies will update to.
//   prints  version=0.6.3
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(pkg.version)
if (!m) throw new Error(`package.json version is not MAJOR.MINOR.PATCH: ${pkg.version}`)
const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]

/** Pure part, unit-tested: tags of releases that are already PUBLISHED -> the next version. */
export function nextVersion(major, minor, patch, publishedTags) {
  let highest = -1
  for (const tag of publishedTags) {
    const t = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag)
    if (t && Number(t[1]) === major && Number(t[2]) === minor) highest = Math.max(highest, Number(t[3]))
  }
  return `${major}.${minor}.${Math.max(patch, highest + 1)}`
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let tags = []
  try {
    const out = execFileSync('gh', ['release', 'list', '--limit', '200', '--json', 'tagName,isDraft'], { encoding: 'utf8' })
    tags = JSON.parse(out)
      .filter((r) => !r.isDraft)
      .map((r) => r.tagName)
  } catch (err) {
    console.error(`Could not list releases (${err instanceof Error ? err.message.split('\n')[0] : err}); using package.json's version.`)
  }
  console.log(`version=${nextVersion(major, minor, patch, tags)}`)
}
