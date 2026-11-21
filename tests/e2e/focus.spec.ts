import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { inMain, launch, sleep } from './helpers'
import type { Harness } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'

let server: TestServer
let h: Harness
test.beforeAll(async () => {
  server = await startServer()
  h = await launch({ BMAX_SHIELDS_OFFLINE: '1' })
})
test.afterAll(async () => {
  await h.close()
  await server.close()
})

const chromePage = (app: ElectronApplication): Page => app.windows().find((p) => p.url().startsWith('bmax://chrome'))!

/** Which of the window's views has keyboard focus right now. */
const focusOwner = (): Promise<string> =>
  inMain<string>(
    h.app,
    `const w = s.windows.focused();
     if (w.chromeView.webContents.isFocused()) return 'chrome';
     if (w.activeTab.wc.isFocused()) return 'tab';
     for (const [kind, e] of w.overlays.entries) if (e.view.webContents.isFocused()) return 'overlay:' + kind;
     return 'none'`
  )

/** A real mouse click on the address bar (the way a user does it: the view takes focus, then the page gets the click). */
async function clickAddressBar(): Promise<void> {
  const box = await chromePage(h.app).getByLabel('Address bar').boundingBox()
  expect(box).not.toBeNull()
  const x = Math.round(box!.x + box!.width / 2)
  const y = Math.round(box!.y + box!.height / 2)
  await inMain(
    h.app,
    `const wc = s.windows.focused().chromeView.webContents;
     wc.focus();
     wc.sendInputEvent({ type: 'mouseDown', x: arg.x, y: arg.y, button: 'left', clickCount: 1 });
     wc.sendInputEvent({ type: 'mouseUp', x: arg.x, y: arg.y, button: 'left', clickCount: 1 })`,
    { x, y }
  )
}

/** Real key presses sent to whichever view has keyboard focus (so a stolen focus loses them, as it does for a user). */
async function typeIntoFocused(text: string): Promise<void> {
  for (const ch of text) {
    await inMain(
      h.app,
      `const w = s.windows.focused();
       let wc = w.chromeView.webContents.isFocused() ? w.chromeView.webContents : w.activeTab.wc.isFocused() ? w.activeTab.wc : null;
       for (const e of w.overlays.entries.values()) if (e.view.webContents.isFocused()) wc = e.view.webContents;
       if (!wc) return;
       wc.sendInputEvent({ type: 'keyDown', keyCode: arg });
       wc.sendInputEvent({ type: 'char', keyCode: arg });
       wc.sendInputEvent({ type: 'keyUp', keyCode: arg })`,
      ch
    )
    await sleep(40)
  }
}

test('the first click in the address bar keeps keyboard focus there, so typing works at once', async () => {
  await inMain(h.app, `s.windows.focused().go(arg)`, `${server.origin}/b`)
  await sleep(1200)
  await inMain(h.app, `s.windows.focused().activeTab.wc.focus()`)
  await sleep(200)
  expect(await focusOwner()).toBe('tab')
  // No suggestion popup exists yet: the first click has to create it.
  expect(await inMain<boolean>(h.app, `return s.windows.focused().overlays.entries.has('suggest')`)).toBe(false)

  await clickAddressBar()
  await sleep(1500)
  expect(await focusOwner()).toBe('chrome')
  const input = chromePage(h.app).getByLabel('Address bar')
  expect(await input.evaluate((el) => document.activeElement === el && document.hasFocus())).toBe(true)

  await typeIntoFocused('hello')
  await sleep(300)
  await expect(input).toHaveValue('hello')
  expect(await focusOwner()).toBe('chrome')

  // The same after the popup has been thrown away to save memory.
  await chromePage(h.app).keyboard.press('Escape')
  await inMain(h.app, `const w = s.windows.focused(); w.overlays.hide('suggest'); w.overlays.release('suggest'); w.activeTab.wc.focus()`)
  await sleep(300)
  await clickAddressBar()
  await sleep(1200)
  await typeIntoFocused('again')
  await sleep(300)
  await expect(input).toHaveValue('again')
})

test('a menu that is taller than the window scrolls instead of being cut off, and knows the window state at once', async () => {
  await inMain(h.app, `const w = s.windows.focused(); w.overlays.hideAll(); w.overlays.release('menu'); w.base.setSize(1000, 520)`)
  await sleep(500)
  await chromePage(h.app).getByLabel('Menu').click()
  let menu: Page | undefined
  for (let i = 0; i < 40 && !menu; i++) {
    menu = h.app.windows().find((p) => p.url().includes('kind=menu'))
    if (!menu) await sleep(150)
  }
  expect(menu).toBeTruthy()
  await expect(menu!.getByText('New tab', { exact: true })).toBeVisible()
  // The bookmarks bar is on by default: a brand-new menu must already say "Hide".
  await expect(menu!.getByText('Hide bookmarks bar')).toHaveCount(1)

  const card = menu!.locator('.overlay-card')
  const size = await card.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(size.scroll).toBeGreaterThan(size.client)
  // The popup stays inside the window.
  const fits = await inMain<boolean>(h.app, `const w = s.windows.focused(); const b = w.overlays.entries.get('menu').view.getBounds(); return b.y + b.height <= w.contentSize()[1]`)
  expect(fits).toBe(true)

  const last = menu!.getByText('Privacy policy')
  await expect(last).not.toBeInViewport()
  await card.hover()
  await menu!.mouse.wheel(0, 2000)
  await expect(last).toBeInViewport()
  await inMain(h.app, `const w = s.windows.focused(); w.overlays.hideAll(); w.base.setSize(1280, 820)`)
})
