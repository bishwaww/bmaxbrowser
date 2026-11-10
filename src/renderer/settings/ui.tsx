import type { ReactNode } from 'react'

export const inputStyle = { background: 'var(--field)', border: '1px solid var(--border)', userSelect: 'text' as const }

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="rounded-xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        {children}
      </div>
    </section>
  )
}

export function Radio<T extends string>({
  name,
  value,
  options,
  onChange
}: {
  name: string
  value: T
  options: { value: T; label: string; hint?: string | undefined }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-3">
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            {o.label}
            {o.hint && (
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                {o.hint}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-6 py-1.5">
      <span>
        {label}
        {hint && (
          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
            {hint}
          </span>
        )}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  danger,
  primary
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  primary?: boolean
}) {
  return (
    <button
      disabled={disabled}
      className="rounded-full px-4 py-2 disabled:opacity-50"
      style={
        primary
          ? { background: 'var(--accent)', color: 'var(--on-accent)' }
          : { border: `1px solid ${danger ? 'var(--danger)' : 'var(--border)'}`, color: danger ? 'var(--danger)' : undefined }
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}
