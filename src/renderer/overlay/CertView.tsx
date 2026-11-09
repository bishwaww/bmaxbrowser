import { useEffect, useState } from 'react'
import type { CertInfo } from '@shared/types'

function fmt(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{label}</div>
      <div style={{ userSelect: 'text', wordBreak: 'break-all', fontSize: 12 }}>{value}</div>
    </div>
  )
}

export function CertView({ data }: { data: { tabId: number; url: string; security: string } }) {
  const [cert, setCert] = useState<CertInfo | null>(null)
  useEffect(() => {
    setCert(null)
    void window.bmax.cmd('cert.get', { tabId: data.tabId }).then(setCert)
  }, [data.tabId, data.url])

  let host = data.url
  try {
    host = new URL(data.url).host || data.url
  } catch {
    /* keep raw */
  }

  let headline = 'Site information'
  let body = ''
  let color = 'var(--fg)'
  switch (data.security) {
    case 'secure':
      headline = 'Connection is secure'
      body = 'Information you send to this site (passwords, messages) is encrypted in transit.'
      color = 'var(--ok)'
      break
    case 'insecure':
      headline = 'Connection is not secure'
      body = 'Do not enter sensitive information on this site: others on the network could read or change it.'
      color = 'var(--danger)'
      break
    case 'error':
      headline = 'Certificate problem'
      body = "This site's certificate could not be verified."
      color = 'var(--danger)'
      break
    case 'internal':
      headline = 'This is a BMAX page'
      body = 'Built into the browser. It does not load anything from the internet.'
      break
    case 'file':
      headline = 'Local file'
      body = 'This page is a file on your computer.'
      break
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color }}>{headline}</div>
      <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 12 }}>{body}</div>
      <div style={{ marginTop: 10, fontSize: 12, userSelect: 'text' }}>{host}</div>
      {cert && (
        <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
          <Field label="Issued to" value={cert.subject} />
          <Field label="Issued by" value={cert.issuer} />
          <Field label="Valid" value={`${fmt(cert.validFrom)} – ${fmt(cert.validTo)}`} />
          <Field label="Fingerprint" value={cert.fingerprint} />
        </div>
      )}
    </div>
  )
}
