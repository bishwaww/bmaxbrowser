export const TABSTRIP_H = 40
export const TOOLBAR_H = 44
export const CHROME_H = TABSTRIP_H + TOOLBAR_H

export interface ChromeColors {
  strip: string
  symbol: string
}

export function chromeColors(dark: boolean, tor = false): ChromeColors {
  if (tor) return { strip: '#2d1950', symbol: '#eadcff' }
  return dark ? { strip: '#202124', symbol: '#e8eaed' } : { strip: '#dee1e6', symbol: '#202124' }
}
