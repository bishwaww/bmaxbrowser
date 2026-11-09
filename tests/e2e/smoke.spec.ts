import { expect, test } from '@playwright/test'
import type { Harness } from './helpers'
import { inMain, launch, screenshot, sleep } from './helpers'

let h: Harness
test.beforeAll(async () => {
  h = await launch()
})
test.afterAll(async () => {
  await h.close()
})

test('starts with one window showing the new tab page', async () => {
  const info = await inMain<{ windows: number; tabs: number; url: string }>(
    h.app,
    `const w = s.windows.focused(); return { windows: s.windows.all().length, tabs: w.tabs.length, url: w.activeTab.url }`
  )
  expect(info.windows).toBe(1)
  expect(info.tabs).toBe(1)
  expect(info.url).toBe('bmax://newtab/')
  await sleep(800)
  await screenshot(h.app, 'chrome', 'chrome-initial.png')
  await screenshot(h.app, 'tab', 'newtab-initial.png')
})
