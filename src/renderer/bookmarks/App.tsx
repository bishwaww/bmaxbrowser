import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Bookmark, PasswordEntry, VaultStatus } from '@shared/vault'

const field = { background: 'var(--field)', border: '1px solid var(--border)', userSelect: 'text' as const }
const primary = { background: 'var(--accent)', color: 'var(--on-accent)' }

function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="mb-5 rounded-xl p-5" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  )
}

function generatePassword(len = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+'
  const bytes = new Uint32Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function Setup({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) return setErr('The passwords do not match.')
    const r = await window.bmax.cmd('vault.create', { password: pw })
    if (r.ok) onDone()
    else setErr(r.error ?? 'Could not create the vault.')
  }
  return (
    <Card title="Set up the password vault">
      <p className="mb-3" style={{ color: 'var(--muted)' }}>
        Saved passwords are <strong>off by default</strong>. If you turn them on, they are stored only on this computer, encrypted with a key derived
        from a master password you choose and wrapped by your operating system&apos;s secure storage. Nothing is ever uploaded. (Bookmarks do not need
        this: they are always available on the Bookmarks tab.)
      </p>
      <p className="mb-4" style={{ color: 'var(--muted)' }}>
        The master password cannot be recovered. If you forget it, the vault can only be deleted.
      </p>
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
        <input type="password" autoFocus placeholder="Master password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} className="rounded-md px-3 py-2" style={field} />
        <input type="password" placeholder="Repeat master password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="rounded-md px-3 py-2" style={field} />
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <button type="submit" className="self-start rounded-full px-5 py-2" style={primary}>
          Create vault
        </button>
      </form>
    </Card>
  )
}

function Unlock({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const r = await window.bmax.cmd('vault.unlock', { password: pw })
    if (r.ok) onDone()
    else setErr(r.error ?? 'Could not unlock.')
  }
  return (
    <Card title="The password vault is locked">
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
        <input type="password" autoFocus placeholder="Master password" value={pw} onChange={(e) => setPw(e.target.value)} className="rounded-md px-3 py-2" style={field} />
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        <button type="submit" className="self-start rounded-full px-5 py-2" style={primary}>
          Unlock
        </button>
      </form>
    </Card>
  )
}

function Bookmarks({ pendingAdd }: { pendingAdd: { url: string; title: string } | null }) {
  const [items, setItems] = useState<Bookmark[]>([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [pending, setPending] = useState(pendingAdd)
  const load = useCallback(() => void window.bmax.cmd('bookmarks.list').then(setItems), [])
  useEffect(load, [load])
  useEffect(() => window.bmax.onPush((m) => m.type === 'bookmarks' && load()), [load])
  const shown = items.filter((b) => !q || (b.title + ' ' + b.url + ' ' + b.folder).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      {pending && (
        <Card>
          <p className="mb-2">
            Add <strong>{pending.title || pending.url}</strong> to your bookmarks?
          </p>
          <button
            className="rounded-full px-5 py-2"
            style={primary}
            onClick={async () => {
              await window.bmax.cmd('bookmarks.add', { title: pending.title, url: pending.url })
              setPending(null)
              load()
            }}
          >
            Add bookmark
          </button>
        </Card>
      )}
      <Card>
        <div className="mb-3 flex items-center gap-3">
          <input placeholder="Search bookmarks" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 rounded-md px-3 py-2" style={field} />
          <button
            className="rounded-full px-4 py-2"
            style={{ border: '1px solid var(--border)' }}
            onClick={async () => {
              const r = await window.bmax.cmd('bookmarks.import')
              setMsg(r.error ? r.error : r.added ? `Imported ${r.added} bookmarks.` : 'Nothing new to import.')
              load()
            }}
          >
            Import from Chrome (HTML)…
          </button>
        </div>
        {msg && <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>{msg}</p>}
        {shown.length === 0 && <p style={{ color: 'var(--muted)' }}>No bookmarks yet. Click the ☆ star in the toolbar (or press Ctrl+D) on a page to add one.</p>}
        <ul>
          {shown.map((b) => (
            <li key={b.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--hover)]">
              <button className="min-w-0 flex-1 text-left" onClick={() => void window.bmax.cmd('page.navigate', { input: b.url })}>
                <div className="truncate">{b.title}</div>
                <div className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                  {b.folder ? `${b.folder} · ` : ''}
                  {b.url}
                </div>
              </button>
              <button
                className="icon-btn opacity-0 group-hover:opacity-100"
                title="Delete"
                onClick={async () => {
                  await window.bmax.cmd('bookmarks.remove', { id: b.id })
                  load()
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function Passwords() {
  const [items, setItems] = useState<PasswordEntry[]>([])
  const [editing, setEditing] = useState<{ id?: string; site: string; username: string; password: string } | null>(null)
  const [shown, setShown] = useState<Record<string, string>>({})
  const load = useCallback(() => void window.bmax.cmd('passwords.list').then(setItems), [])
  useEffect(load, [load])

  const copy = async (id: string) => {
    const pw = await window.bmax.cmd('passwords.reveal', { id })
    if (pw === null) return
    await navigator.clipboard.writeText(pw)
    // Best effort: clear the clipboard again after 30 seconds.
    setTimeout(() => void navigator.clipboard.writeText('').catch(() => undefined), 30_000)
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p style={{ color: 'var(--muted)' }}>Saved passwords are copied to your clipboard on request and are never filled in automatically.</p>
        <button className="rounded-full px-4 py-2" style={primary} onClick={() => setEditing({ site: '', username: '', password: generatePassword() })}>
          Add password
        </button>
      </div>
      {items.length === 0 && <p style={{ color: 'var(--muted)' }}>No saved passwords.</p>}
      <ul>
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--hover)]">
            <div className="min-w-0 flex-1">
              <div className="truncate">{p.site}</div>
              <div className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                {p.username} {shown[p.id] !== undefined && <span style={{ userSelect: 'text' }}> · {shown[p.id]}</span>}
              </div>
            </div>
            <button className="rounded-full px-3 py-1 text-xs" style={{ border: '1px solid var(--border)' }} onClick={() => void copy(p.id)}>
              Copy
            </button>
            <button
              className="rounded-full px-3 py-1 text-xs"
              style={{ border: '1px solid var(--border)' }}
              onClick={async () => {
                if (shown[p.id] !== undefined) setShown(({ [p.id]: _x, ...rest }) => rest)
                else setShown({ ...shown, [p.id]: (await window.bmax.cmd('passwords.reveal', { id: p.id })) ?? '' })
              }}
            >
              {shown[p.id] !== undefined ? 'Hide' : 'Show'}
            </button>
            <button
              className="rounded-full px-3 py-1 text-xs"
              style={{ border: '1px solid var(--border)' }}
              onClick={async () => setEditing({ id: p.id, site: p.site, username: p.username, password: (await window.bmax.cmd('passwords.reveal', { id: p.id })) ?? '' })}
            >
              Edit
            </button>
            <button
              className="rounded-full px-3 py-1 text-xs"
              style={{ border: '1px solid var(--border)' }}
              onClick={async () => {
                await window.bmax.cmd('passwords.remove', { id: p.id })
                load()
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="fixed inset-0 z-10 grid place-items-center" style={{ background: 'rgba(0,0,0,0.45)' }} onMouseDown={() => setEditing(null)}>
          <form
            className="w-96 rounded-xl p-5"
            style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault()
              if (!editing.site.trim() || !editing.password) return
              await window.bmax.cmd('passwords.save', { id: editing.id, site: editing.site.trim(), username: editing.username, password: editing.password })
              setEditing(null)
              setShown({})
              load()
            }}
          >
            <h2 className="mb-3 text-base font-semibold">{editing.id ? 'Edit password' : 'Add password'}</h2>
            <input autoFocus placeholder="Website (example.com)" value={editing.site} onChange={(e) => setEditing({ ...editing, site: e.target.value })} className="mb-3 w-full rounded-md px-3 py-2" style={field} />
            <input placeholder="Username or email" value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} className="mb-3 w-full rounded-md px-3 py-2" style={field} />
            <div className="mb-4 flex gap-2">
              <input placeholder="Password" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} className="min-w-0 flex-1 rounded-md px-3 py-2" style={field} />
              <button type="button" className="rounded-md px-3" style={{ border: '1px solid var(--border)' }} onClick={() => setEditing({ ...editing, password: generatePassword() })}>
                Generate
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-full px-4 py-1.5" style={{ border: '1px solid var(--border)' }} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="rounded-full px-4 py-1.5" style={primary}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </Card>
  )
}

function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  return (
    <Card title="Delete vault">
      {!open ? (
        <button className="rounded-full px-4 py-2" style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }} onClick={() => setOpen(true)}>
          Delete the vault and all saved passwords…
        </button>
      ) : (
        <form
          className="flex max-w-sm flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await window.bmax.cmd('vault.destroy', { password: pw })
            if (r.ok) onDeleted()
            else setErr(r.error ?? 'Failed')
          }}
        >
          <p style={{ color: 'var(--muted)' }}>This permanently deletes every saved password. It cannot be undone. Your bookmarks are not affected.</p>
          <input type="password" placeholder="Master password" value={pw} onChange={(e) => setPw(e.target.value)} className="rounded-md px-3 py-2" style={field} />
          {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
          <button type="submit" className="self-start rounded-full px-4 py-2" style={{ background: 'var(--danger)', color: 'var(--on-accent)' }}>
            Delete permanently
          </button>
        </form>
      )}
    </Card>
  )
}

export function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const q = new URLSearchParams(location.search)
  const [tab, setTab] = useState<'bookmarks' | 'passwords'>(q.get('tab') === 'passwords' ? 'passwords' : 'bookmarks')
  const refresh = useCallback(() => void window.bmax.cmd('vault.status').then(setStatus), [])
  useEffect(refresh, [refresh])
  useEffect(() => {
    document.title = tab === 'bookmarks' ? 'Bookmarks' : 'Saved passwords'
  }, [tab])

  const add = q.get('add')
  const pendingAdd = add ? { url: add, title: q.get('title') ?? '' } : null

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--field)' }}>
      <main className="mx-auto max-w-3xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{tab === 'bookmarks' ? 'Bookmarks' : 'Saved passwords'}</h1>
          {tab === 'passwords' && status?.unlocked && (
            <button
              className="rounded-full px-4 py-2"
              style={{ border: '1px solid var(--border)' }}
              onClick={async () => {
                await window.bmax.cmd('vault.lock')
                refresh()
              }}
            >
              Lock vault
            </button>
          )}
        </div>

        <div className="mb-4 flex gap-2" role="tablist">
          {(['bookmarks', 'passwords'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className="rounded-full px-4 py-2 capitalize"
              style={{ background: tab === t ? 'var(--active)' : undefined }}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'bookmarks' && <Bookmarks pendingAdd={pendingAdd} />}

        {tab === 'passwords' && status && (
          <>
            {!status.available && (
              <Card title="Not available on this system">
                <p style={{ color: 'var(--muted)' }}>
                  BMAX needs your operating system&apos;s secure storage (Windows DPAPI, macOS Keychain, or a Linux keyring) to protect saved passwords, and
                  it is not available here. The vault stays off rather than storing anything unprotected.
                </p>
              </Card>
            )}
            {status.available && !status.exists && <Setup onDone={refresh} />}
            {status.available && status.exists && !status.unlocked && <Unlock onDone={refresh} />}
            {status.unlocked && (
              <>
                <Passwords />
                <DangerZone onDeleted={refresh} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
