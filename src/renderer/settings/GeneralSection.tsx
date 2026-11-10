import type { Settings, SettingsPatch } from '@shared/settings'
import { Group, inputStyle, Toggle } from './ui'

const SLEEP_CHOICES = [
  { value: 0, label: 'Never' },
  { value: 5, label: 'After 5 minutes' },
  { value: 15, label: 'After 15 minutes' },
  { value: 30, label: 'After 30 minutes' },
  { value: 60, label: 'After 1 hour' },
  { value: 240, label: 'After 4 hours' }
]

export function GeneralSection({ settings, update }: { settings: Settings; update: (p: SettingsPatch) => void }) {
  const g = settings.general
  const set = (patch: Partial<Settings['general']>) => update({ general: { ...g, ...patch } })
  const sleepValue = SLEEP_CHOICES.some((c) => c.value === g.sleepTabsAfterMin) ? g.sleepTabsAfterMin : 30
  return (
    <>
      <Group title="On start-up">
        <Toggle
          checked={g.restoreSession}
          onChange={(restoreSession) => set({ restoreSession })}
          label="Continue where I left off"
          hint="Reopens last time's tabs. Off by default, because it writes the addresses of your open tabs (never cookies or page data) to a file in the app data folder. Tor windows, isolated windows and container tabs are never saved. Turning this off, or using Burn, deletes the file."
        />
      </Group>

      <Group title="Memory">
        <label className="flex items-center justify-between gap-6 py-1.5">
          <span>
            Put background tabs to sleep
            <span className="block text-xs" style={{ color: 'var(--muted)' }}>
              A sleeping tab frees its memory and reloads when you select it. Tabs that play audio, show picture-in-picture, are loading or have DevTools open are never put to sleep.
            </span>
          </span>
          <select
            aria-label="Put background tabs to sleep"
            value={sleepValue}
            onChange={(e) => set({ sleepTabsAfterMin: Number(e.target.value) })}
            className="rounded-md px-2 py-2"
            style={inputStyle}
          >
            {SLEEP_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </Group>

      <Group title="Updates">
        <Toggle
          checked={g.checkUpdates}
          onChange={(checkUpdates) => set({ checkUpdates })}
          label="Check for updates automatically"
          hint="About once a day BMAX asks GitHub Releases whether a newer version exists (this reveals your IP address and version to GitHub, like any download). Nothing is downloaded or installed until you click Update in Settings → About."
        />
      </Group>
    </>
  )
}
