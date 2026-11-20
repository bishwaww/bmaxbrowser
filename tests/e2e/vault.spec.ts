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

const vaultFile = (): string => join(h.userData, 'vault.bin')

test.describe.serial('encrypted password vault', () => {
  test('is off by default and refuses weak master passwords', async () => {
    const st = await inMain<{ available: boolean; exists: boolean; unlocked: boolean }>(h.app, 'return s.vault.status()')
    expect(st.exists).toBe(false)
    expect(st.unlocked).toBe(false)
    test.skip(!st.available, 'OS secure storage not available on this machine')
    expect(await inMain(h.app, `return s.vault.create('short')`)).toMatchObject({ ok: false })
  })

  test('create → save a password → nothing readable on disk', async () => {
    expect(await inMain(h.app, `return s.vault.create('correct horse battery')`)).toEqual({ ok: true })
    await inMain(h.app, `s.vault.savePassword({ site: 'bank.secret-site.example', username: 'alice@secret-mail.example', password: 'hunter2-hunter2' })`)
    const bytes = readFileSync(vaultFile()).toString('latin1')
    for (const needle of ['secret-site', 'alice@', 'hunter2', 'bank.']) {
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
    const threw = await inMain<boolean>(h.app, `try { s.vault.passwords(); return false } catch { return true }`)
    expect(threw).toBe(true)
    expect(await inMain(h.app, `return s.vault.unlock('wrong password')`)).toMatchObject({ ok: false })
    await sleep(1200) // brute-force delay after a failure
    expect(await inMain(h.app, `return s.vault.unlock('correct horse battery')`)).toEqual({ ok: true })
    expect(await inMain<number>(h.app, 'return s.vault.passwords().length')).toBe(1)
  })

  test('bookmarks that an older version kept in the vault move to the bookmark list on unlock', async () => {
    // Put a legacy bookmark inside the (unlocked) vault, lock it, then unlock through the page command.
    await inMain(h.app, `s.vault.data.bookmarks.push({ id: 'legacy-1', title: 'Legacy', url: 'https://legacy.example/', folder: '', added: 1 }); s.vault.save(); s.vault.lock()`)
    await inMain(h.app, `s.windows.focused().openTab('bmax://bookmarks/?tab=passwords')`)
    await sleep(1200)
    const page = h.app.windows().find((p) => p.url().startsWith('bmax://bookmarks'))!
    await page.getByPlaceholder('Master password').fill('correct horse battery')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByRole('button', { name: 'Add password' })).toBeVisible({ timeout: 8000 })
    expect(await inMain<string[]>(h.app, 'return s.bookmarks.list().map((b) => b.url)')).toContain('https://legacy.example/')
    expect(await inMain<number>(h.app, 'return s.vault.bookmarks().length')).toBe(0)
    await inMain(h.app, `const w = s.windows.focused(); w.closeTab(w.activeTab); s.bookmarks.removeByUrl('https://legacy.example/')`)
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

  test('set-up through the Passwords tab of the bookmarks page', async () => {
    await inMain(h.app, `s.windows.focused().openTab('bmax://bookmarks')`)
    await sleep(1200)
    const page = h.app.windows().find((p) => p.url().startsWith('bmax://bookmarks'))!
    // Bookmarks need no vault: the list is there straight away.
    await expect(page.getByPlaceholder('Search bookmarks')).toBeVisible()
    await expect(page.getByText('Set up the password vault')).toHaveCount(0)
    await page.getByRole('tab', { name: 'passwords' }).click()
    await expect(page.getByText('Set up the password vault')).toBeVisible()
    await page.getByPlaceholder('Master password (8+ characters)').fill('ui master pass')
    await page.getByPlaceholder('Repeat master password').fill('ui master pass')
    await page.getByRole('button', { name: 'Create vault' }).click()
    await page.getByRole('button', { name: 'Add password' }).click()
    await page.getByPlaceholder('Website (example.com)').fill('example.com')
    await page.getByPlaceholder('Username or email').fill('me')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('example.com', { exact: true })).toBeVisible()
    expect(await inMain<number>(h.app, 'return s.vault.passwords().length')).toBe(1)
  })
})
