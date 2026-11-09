export function App() {
  const q = new URLSearchParams(location.search)
  const url = q.get('url') ?? ''
  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* keep raw */
  }
  return (
    <main className="mx-auto flex h-full max-w-xl flex-col justify-center px-8" style={{ userSelect: 'text' }}>
      <div className="mb-4 text-3xl" aria-hidden="true">
        ⚠
      </div>
      <h1 className="mb-3 text-2xl font-semibold">This site doesn&apos;t support a secure connection</h1>
      <p className="mb-2" style={{ color: 'var(--muted)' }}>
        HTTPS-Only mode is on. BMAX tried to open <strong style={{ color: 'var(--fg)' }}>{host}</strong> over an encrypted connection, but that
        didn&apos;t work.
      </p>
      <p className="mb-6" style={{ color: 'var(--muted)' }}>
        If you continue, anything you send or receive on this site (including passwords) can be read or changed by others on the network.
      </p>
      <div className="flex gap-3">
        <button
          className="rounded-full px-5 py-2"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          onClick={() => void window.bmax.cmd('page.navigate', { input: 'bmax://newtab' })}
        >
          Go to safety
        </button>
        <button
          className="rounded-full px-5 py-2"
          style={{ border: '1px solid var(--border)' }}
          onClick={() => void window.bmax.cmd('warning.proceedHttp', { url })}
        >
          Continue to site over HTTP
        </button>
      </div>
      <p className="mt-8 break-all text-xs" style={{ color: 'var(--muted)' }}>
        {url}
      </p>
    </main>
  )
}
