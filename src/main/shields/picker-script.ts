/**
 * Element picker. Executed inside the page (main world) via webContents.executeJavaScript; the returned Promise resolves with
 * a CSS selector for the clicked element, or null if the user pressed Escape. No IPC from the page is needed.
 *
 * Controls: move the mouse to highlight, click to choose, Arrow Up/Down to pick a larger/smaller target, Esc to cancel.
 */
export const PICKER_SCRIPT = `(() => new Promise((resolve) => {
  const doc = document
  const ID = '__bmax_picker__'
  if (doc.getElementById(ID)) { resolve(null); return }
  const box = doc.createElement('div')
  box.id = ID
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #e8590c;background:rgba(232,89,12,.18);box-sizing:border-box;left:0;top:0;width:0;height:0;transition:all 60ms'
  const tip = doc.createElement('div')
  tip.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:#202124;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:8px;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.4)'
  tip.textContent = 'Click the element to hide it \\u2022 \\u2191/\\u2193 resize selection \\u2022 Esc to cancel'
  doc.documentElement.appendChild(box)
  doc.documentElement.appendChild(tip)
  let target = null
  const unique = (sel) => { try { return doc.querySelectorAll(sel).length === 1 } catch (e) { return false } }
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'))
  function selectorFor(el) {
    if (el.id && unique('#' + esc(el.id))) return '#' + esc(el.id)
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && node !== doc.documentElement) {
      let part = node.tagName.toLowerCase()
      if (node.id && unique('#' + esc(node.id))) { parts.unshift('#' + esc(node.id)); break }
      const classes = Array.from(node.classList).filter((c) => !/^(\\d|__bmax)/.test(c) && c.length < 40).slice(0, 2)
      if (classes.length) part += classes.map((c) => '.' + esc(c)).join('')
      const parent = node.parentElement
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName)
        let candidate = parts.length ? part + ' > ' + parts.join(' > ') : part
        if (same.length > 1 && !unique(candidate)) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      if (unique(parts.join(' > '))) break
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  function show(el) {
    target = el
    const r = el.getBoundingClientRect()
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px'
  }
  function pick(x, y) {
    const els = doc.elementsFromPoint(x, y)
    return els.find((e) => e !== box && e !== tip && e !== doc.documentElement && e !== doc.body) || null
  }
  function done(value) {
    doc.removeEventListener('mousemove', onMove, true)
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('mousedown', block, true)
    doc.removeEventListener('mouseup', block, true)
    doc.removeEventListener('keydown', onKey, true)
    box.remove(); tip.remove()
    resolve(value)
  }
  function block(e) { e.preventDefault(); e.stopPropagation() }
  function onMove(e) { const el = pick(e.clientX, e.clientY); if (el) show(el) }
  function onClick(e) { block(e); if (target) done(selectorFor(target)); else done(null) }
  function onKey(e) {
    if (e.key === 'Escape') { block(e); done(null) }
    else if (e.key === 'ArrowUp' && target && target.parentElement && target.parentElement !== doc.body) { block(e); show(target.parentElement) }
    else if (e.key === 'ArrowDown' && target && target.firstElementChild) { block(e); show(target.firstElementChild) }
  }
  doc.addEventListener('mousemove', onMove, true)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('mousedown', block, true)
  doc.addEventListener('mouseup', block, true)
  doc.addEventListener('keydown', onKey, true)
}))()`
