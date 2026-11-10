/**
 * Generates the app icons from an SVG using Electron itself (no image tools needed):
 *   npx electron scripts/make-icons.cjs
 * Output (committed): resources/icons/icon.png (1024), icon.ico (16-256), icon.icns (16-1024), plus 16..512 PNGs for Linux.
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const OUT = resolve(__dirname, '..', 'resources', 'icons')

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2f77"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="448" rx="208" fill="url(#shine)"/>
  <!-- shield -->
  <path d="M512 176 L792 276 V520 C792 690 668 812 512 868 C356 812 232 690 232 520 V276 Z" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="28" stroke-linejoin="round"/>
  <!-- letter B -->
  <path d="M400 320 V712 M400 320 H550 C632 320 668 362 668 412 C668 462 632 504 550 504 H400 M550 504 H572 C664 504 704 550 704 608 C704 666 664 712 572 712 H400"
        fill="none" stroke="#ffffff" stroke-width="62" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`

/** Render once at full size; smaller sizes are downscaled from it. */
async function renderMaster(size) {
  const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg(size)}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  win.destroy()
  if (img.isEmpty()) throw new Error('empty capture')
  return img
}

function ico(pngs) {
  // PNG-in-ICO (Windows Vista and later).
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)])
}

function icns(items) {
  // items: [{ type: 'ic07', data: png }]
  const chunks = items.map(({ type, data }) => {
    const h = Buffer.alloc(8)
    h.write(type, 0, 'latin1')
    h.writeUInt32BE(8 + data.length, 4)
    return Buffer.concat([h, data])
  })
  const body = Buffer.concat(chunks)
  const h = Buffer.alloc(8)
  h.write('icns', 0, 'latin1')
  h.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([h, body])
}

app.whenReady().then(async () => {
  try {
    mkdirSync(OUT, { recursive: true })
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    const master = await renderMaster(1024)
    const png = {}
    for (const s of sizes) png[s] = (s === 1024 ? master : master.resize({ width: s, height: s, quality: 'best' })).toPNG()
    writeFileSync(join(OUT, 'icon.png'), png[1024])
    for (const s of [16, 32, 48, 64, 128, 256, 512]) writeFileSync(join(OUT, `${s}x${s}.png`), png[s])
    writeFileSync(join(OUT, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, data: png[s] }))))
    writeFileSync(
      join(OUT, 'icon.icns'),
      icns([
        { type: 'icp4', data: png[16] },
        { type: 'icp5', data: png[32] },
        { type: 'icp6', data: png[64] },
        { type: 'ic07', data: png[128] },
        { type: 'ic08', data: png[256] },
        { type: 'ic09', data: png[512] },
        { type: 'ic10', data: png[1024] }
      ])
    )
    console.log('icons written to', OUT)
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
