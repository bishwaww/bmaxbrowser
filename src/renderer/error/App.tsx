const MESSAGES: Record<string, { title: string; body: string }> = {
  '-105': { title: "We can't find that site", body: "The address couldn't be resolved. Check for typos, or try again." },
  '-106': { title: "You're offline", body: 'Check your internet connection.' },
  '-102': { title: 'Connection refused', body: 'The site refused the connection.' },
  '-118': { title: 'Connection timed out', body: 'The site took too long to respond.' },
  '-324': { title: 'No response', body: 'The site closed the connection without sending data.' },
  '-109': { title: 'Address unreachable', body: "The address can't be reached from this network." },
  crashed: { title: 'This tab crashed', body: 'The page stopped unexpectedly. Reload to try again.' }
}

function describe(code: string): { title: string; body: string } {
  const known = MESSAGES[code]
  if (known) return known
  const n = Number(code)
  if (n <= -200 && n >= -219) {
    return {
      title: "Your connection isn't private",
      body: "This site's security certificate could not be trusted, so BMAX blocked the page to protect your data."
    }
  }
  return { title: "This page can't be loaded", body: 'Something went wrong while loading the page.' }
}

export function App() {
  const q = new URLSearchParams(location.search)
  const code = q.get('code') ?? ''
  const desc = q.get('desc') ?? ''
  const url = q.get('url') ?? ''
  const { title, body } = describe(code)
  return (
    <main className="mx-auto flex h-full max-w-xl flex-col justify-center px-8" style={{ userSelect: 'text' }}>
      <h1 className="mb-3 text-2xl font-semibold">{title}</h1>
      <p className="mb-2" style={{ color: 'var(--muted)' }}>
        {body}
      </p>
      {url && (
        <p className="mb-6 break-all text-sm" style={{ color: 'var(--muted)' }}>
          {url}
        </p>
      )}
      <div className="flex gap-3">
        {url && (
          <button
            className="rounded-full px-5 py-2"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            onClick={() => void window.bmax.cmd('page.navigate', { input: url })}
          >
            Try again
          </button>
        )}
      </div>
      <p className="mt-8 text-xs" style={{ color: 'var(--muted)' }}>
        {desc && `${desc}`}
        {code && ` (${code})`}
      </p>
    </main>
  )
}
