export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

export function nextZoom(current: number, dir: 'in' | 'out'): number {
  // Find the closest step to the current factor, then move one step.
  let idx = 0
  let best = Infinity
  ZOOM_STEPS.forEach((s, i) => {
    const d = Math.abs(s - current)
    if (d < best) {
      best = d
      idx = i
    }
  })
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + (dir === 'in' ? 1 : -1)))
  return ZOOM_STEPS[next] ?? 1
}

/** Per-site zoom, kept in memory per session partition (never written to disk). */
export class ZoomStore {
  private map = new Map<string, number>()

  private key(partition: string, host: string): string {
    return `${partition}|${host}`
  }
  get(partition: string, host: string): number {
    return this.map.get(this.key(partition, host)) ?? 1
  }
  set(partition: string, host: string, factor: number): void {
    if (factor === 1) this.map.delete(this.key(partition, host))
    else this.map.set(this.key(partition, host), factor)
  }
  clear(): void {
    this.map.clear()
  }
}
