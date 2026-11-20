/**
 * Generates the app icons from an SVG using Electron itself (no image tools needed):
 *   npx electron scripts/make-icons.cjs
 * Output (committed): resources/icons/icon.png (1024), icon.ico (16-256), icon.icns (16-1024), plus 16..512 PNGs for Linux.
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
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

/**
 * The artwork: resources/icons/source/logo.webp (the BMAX logo: a blue swirl with a white "B", on a white square).
 * Only the round emblem is kept: it is cropped to a circle and the corners become transparent. LOGO describes where
 * the circle sits in the source picture (pixels). Without the file, the built-in SVG above is used.
 */
const LOGO_FILE = join(OUT, 'source', 'logo.webp')
const LOGO = { size: 1254, cx: 623, cy: 623, r: 392 }

/**
 * Draw the artwork on a canvas inside a hidden page and read it back as a PNG. (Capturing the window instead would
 * limit the picture to the size of the screen.) Smaller icon sizes are downscaled from this master.
 */
async function renderMaster(size) {
  const win = new BrowserWindow({ width: 200, height: 200, show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body></body></html>'))
  const useLogo = existsSync(LOGO_FILE)
  const src = useLogo
    ? 'data:image/webp;base64,' + readFileSync(LOGO_FILE).toString('base64')
    : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(size))
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const size = ${size}, logo = ${JSON.stringify(LOGO)}, useLogo = ${useLogo};
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (useLogo) {
      const d = Math.round(size * 0.97);           // emblem diameter inside the icon
      const scale = d / (2 * logo.r);
      ctx.beginPath(); ctx.arc(size / 2, size / 2, d / 2, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, size / 2 - logo.cx * scale, size / 2 - logo.cy * scale, logo.size * scale, logo.size * scale);
    } else ctx.drawImage(img, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  })()`)
  win.destroy()
  const img = nativeImage.createFromDataURL(dataUrl)
  const got = img.getSize()
  if (got.width !== size || got.height !== size) throw new Error(`unexpected master size ${got.width}x${got.height}`)
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
