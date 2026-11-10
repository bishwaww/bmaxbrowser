import { formatShortcut, SHORTCUT_DOCS } from '@shared/shortcuts'
import { Group } from './ui'

export function ShortcutsSection() {
  const platform = window.bmax.platform
  const groups = [...new Set(SHORTCUT_DOCS.map((s) => s.group))]
  return (
    <>
      {groups.map((g) => (
        <Group key={g} title={g}>
          <table className="w-full">
            <tbody>
              {SHORTCUT_DOCS.filter((s) => s.group === g).map((s) => (
                <tr key={s.command} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="py-1.5">{s.label}</td>
                  <td className="py-1.5 text-right">
                    <kbd className="rounded px-2 py-0.5 text-xs" style={{ background: 'var(--field)', border: '1px solid var(--border)' }}>
                      {formatShortcut(s.keys, platform)}
                    </kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      ))}
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Shortcuts follow Chrome&rsquo;s. They work even while a web page has the focus. Custom key bindings are not available yet.
      </p>
    </>
  )
}
