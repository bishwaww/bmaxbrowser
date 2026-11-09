import { useState } from 'react'
import type { PermissionPromptData } from '@shared/types'

export function PermissionView({ data }: { data: PermissionPromptData }) {
  const [remember, setRemember] = useState(true)
  const respond = (allow: boolean) => {
    void window.bmax.cmd('permission.respond', { requestId: data.requestId, allow, remember })
  }
  return (
    <div style={{ padding: 16 }} role="dialog" aria-label="Permission request">
      <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-all' }}>{data.origin}</div>
      <div style={{ marginTop: 4, fontSize: 13 }}>wants to {data.label}</div>
      <label className="flex items-center gap-2" style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember my decision for this site
      </label>
      <div className="flex justify-end gap-2" style={{ marginTop: 14 }}>
        <button className="rounded-full px-4" style={{ height: 32, border: '1px solid var(--border)' }} onClick={() => respond(false)}>
          Block
        </button>
        <button className="rounded-full px-4" style={{ height: 32, background: 'var(--accent)', color: 'var(--on-accent)' }} onClick={() => respond(true)}>
          Allow
        </button>
      </div>
    </div>
  )
}
