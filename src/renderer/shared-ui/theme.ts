/**
 * Internal pages follow the theme chosen in main (nativeTheme + the user's setting, or 'tor' inside Tor windows).
 * We do not rely on `prefers-color-scheme`: it does not track nativeTheme for WebContentsView.
 */
export function initTheme(): void {
  const apply = (theme: 'light' | 'dark' | 'tor'): void => {
    document.documentElement.dataset.theme = theme
  }
  void window.bmax.cmd('theme.get').then(apply)
  window.bmax.onPush((m) => {
    if (m.type === 'theme') apply(m.theme)
  })
}
