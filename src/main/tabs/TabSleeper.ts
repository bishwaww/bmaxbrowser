import { services } from '../services'

const SWEEP_MS = 30_000

/** Puts background tabs to sleep after the configured idle time (Settings → General). Sleeping frees the page's memory; the tab reloads when selected. */
export class TabSleeper {
  private timer: NodeJS.Timeout | null = null

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS)
    this.timer.unref()
  }

  /** Sleep every eligible tab idle for at least the configured time. Returns how many were put to sleep. */
  async sweep(now = Date.now()): Promise<number> {
    const minutes = services.settings.get().general.sleepTabsAfterMin
    if (minutes <= 0) return 0
    let slept = 0
    for (const win of services.windows.all()) {
      for (const tab of [...win.tabs]) {
        if (now - tab.lastActiveAt < minutes * 60_000 || !tab.canSleep()) continue
        // A tab showing picture-in-picture is "in use" even though it is in the background.
        if (await tab.hasPictureInPicture()) continue
        if (tab.sleep()) slept++
      }
    }
    return slept
  }
}
