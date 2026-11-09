import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Harness } from './helpers'
import { inMain, launch, sleep } from './helpers'
import { startServer } from './server'
import type { TestServer } from './server'

let h: Harness
let srv: TestServer

test.beforeAll(async () => {
  srv = await startServer()
  h = await launch()
})
test.afterAll(async () => {
  await h.close()
  await srv.close()
})

const press = async (key: string, mods: string[]): Promise<void> => {
  await inMain(h.app, `const wc = s.windows.focused().chromeView.webContents; wc.sendInputEvent({type:'keyDown', keyCode: arg.key, modifiers: arg.mods}); wc.sendInputEvent({type:'keyUp', keyCode: arg.key, modifiers: arg.mods})`, { key, mods })
  await sleep(300)
}
const vaultFile = (): string => join(h.userData, 'vault.bin')

test.describe.serial('encrypted vault', () => {
  test('is off by default and refuses weak master passwords', async () => {
    const st = await inMain<{ available: boolean; exists: boolean; unlocked: boolean }>(h.app, 'return s.vault.status()')
    expect(st.exists).toBe(false)
    expect(st.unlocked).toBe(false)
    test.skip(!st.available, 'OS secure storage not available on this machine')
    expect(await inMain(h.app, `return s.vault.create('short')`)).toMatchObject({ ok: false })
  })

  test('create → save data → nothing readable on disk', async () => {
    expect(await inMain(h.app, `return s.vault.create('correct horse battery')`)).toEqual({ ok: true })
    await inMain(
      h.app,
      `s.vault.addBookmark({ title: 'Secret bookmark title', url: 'https://secret-site.example/private?token=abc' });
       s.vault.savePassword({ site: 'bank.secret-site.example', username: 'alice@secret-mail.example', password: 'hunter2-hunter2' })`
    )
    const bytes = readFileSync(vaultFile()).toString('latin1')
    for (const needle of ['secret-site', 'Secret bookmark', 'alice@', 'hunter2', 'token=abc', 'bank.']) {
      expect(bytes.includes(needle), needle).toBe(false)
    }
    // Passwords are never returned by the list call; only an explicit reveal returns one.
    const listed = await inMain<string>(h.app, 'return JSON.stringify(s.vault.passwords())')
    expect(listed).not.toContain('hunter2')
    const id = await inMain<string>(h.app, 'return s.vault.passwords()[0].id')
    expect(await inMain(h.app, 'return s.vault.reveal(arg)', id)).toBe('hunter2-hunter2')
  })

  test('lock hides the data; wrong password is rejected; right password restores it', async () => {
    await inMain(h.app, 's.vault.lock()')
    expect(await inMain<boolean>(h.app, 'return s.vault.isUnlocked()')).toBe(false)
    const threw = await inMain<boolean>(h.app, `try { s.vault.bookmarks(); return false } catch { return true }`)
    expect(threw).toBe(true)
    expect(await inMain(h.app, `return s.vault.unlock('wrong password')`)).toMatchObject({ ok: false })
    await sleep(1200) // brute-force delay after a failure
    expect(await inMain(h.app, `return s.vault.unlock('correct horse battery')`)).toEqual({ ok: true })
    expect(await inMain<number>(h.app, 'return s.vault.bookmarks().length')).toBe(1)
    expect(await inMain<number>(h.app, 'return s.vault.passwords().length')).toBe(1)
  })

  test('Ctrl+D toggles a bookmark for the current page; star state follows', async () => {
    await inMain(h.app, `const w = s.windows.focused(); w.go(arg)`, `${srv.origin}/b`)
    await sleep(1000)
    const bookmarked = (): Promise<boolean> => inMain(h.app, 'return s.windows.focused().activeTab.info().bookmarked')
    expect(await bookmarked()).toBe(false)
    await press('D', ['control'])
    expect(await bookmarked()).toBe(true)
    expect(await inMain<number>(h.app, 'return s.vault.bookmarks().length')).toBe(2)
    await press('D', ['control'])
    expect(await bookmarked()).toBe(false)
  })

  test('imports a Chrome bookmarks HTML export (deduplicated)', async () => {
    const html = `<DL><DT><H3>Imported</H3><DL><DT><A HREF="https://one.example/">One</A><DT><A HREF="https://two.example/">Two</A></DL></DL>`
    const added = await inMain<number>(
      h.app,
      `const items = []; const re = /<A HREF="([^"]+)">([^<]*)<\\/A>/g; let m; while ((m = re.exec(arg))) items.push({ title: m[2], url: m[1], folder: 'Imported' }); return s.vault.importBookmarks(items.concat(items))`,
      html
    )
    expect(added).toBe(2)
  })

  test('locked vault: Ctrl+D opens the bookmarks page to unlock instead of saving', async () => {
    await inMain(h.app, 's.vault.lock()')
    await inMain(h.app, `const w = s.windows.focused(); w.go(arg)`, `${srv.origin}/b`)
    await sleep(1000)
    await press('D', ['control'])
    await sleep(800)
    const url = await inMain<string>(h.app, 'return s.windows.focused().activeTab.url')
    expect(url.startsWith('bmax://bookmarks/')).toBe(true)
    expect(url).toContain('add=')
    expect(await inMain(h.app, `return s.vault.unlock('correct horse battery')`)).toEqual({ ok: true })
  })

  test('Burn locks the vault; deleting needs the master password', async () => {
    await inMain(h.app, 'await s.windows.burn()')
    await sleep(800)
    expect(await inMain<boolean>(h.app, 'return s.vault.isUnlocked()')).toBe(false)
    expect(await inMain(h.app, `return s.vault.destroy('nope')`)).toMatchObject({ ok: false })
    await sleep(1200)
    expect(await inMain(h.app, `return s.vault.destroy('correct horse battery')`)).toEqual({ ok: true })
    expect(await inMain<boolean>(h.app, 'return s.vault.status().exists')).toBe(false)
  })

  test('set-up through the bookmarks page UI', async () => {
    await inMain(h.app, `s.windows.focused().openTab('bmax://bookmarks')`)
    await sleep(1200)
    const page = h.app.windows().find((p) => p.url().startsWith('bmax://bookmarks'))!
    await expect(page.getByText('Set up your local vault')).toBeVisible()
    await page.getByPlaceholder('Master password (8+ characters)').fill('ui master pass')
    await page.getByPlaceholder('Repeat master password').fill('ui master pass')
    await page.getByRole('button', { name: 'Create vault' }).click()
    await expect(page.getByRole('tab', { name: 'bookmarks' })).toBeVisible({ timeout: 8000 })
    await page.getByRole('tab', { name: 'passwords' }).click()
    await page.getByRole('button', { name: 'Add password' }).click()
    await page.getByPlaceholder('Website (example.com)').fill('example.com')
    await page.getByPlaceholder('Username or email').fill('me')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('example.com', { exact: true })).toBeVisible()
    expect(await inMain<number>(h.app, 'return s.vault.passwords().length')).toBe(1)
  })
})
