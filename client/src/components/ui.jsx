import React from 'react'

export function StatTile({ label, value, sub, accent = false, icon = null }) {
  return (
    <div className={`stat-tile ${accent ? 'ring-brand-200 bg-brand-50/40' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        {icon ? (
          <span className={`rounded-md p-1.5 ${accent ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
            {icon}
          </span>
        ) : null}
      </div>
      <span className="text-2xl font-semibold text-slate-900">{value}</span>
      {sub ? <span className="text-xs text-slate-500">{sub}</span> : null}
    </div>
  )
}

const PROGRESS_TONE = {
  brand: 'bg-brand-600',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
}

// A thin usage/progress bar — e.g. "12 of 100 projects used".
// `value`/`max` render a filled ratio; pass `indeterminate` for an unknown max.
export function ProgressBar({ value = 0, max = 100, tone = 'brand', label }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="flex flex-col gap-1">
      {label ? <div className="flex items-center justify-between text-xs text-slate-500">{label}</div> : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${PROGRESS_TONE[tone] || PROGRESS_TONE.brand} transition-[width]`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// Small circular initials avatar, used in the sidebar/user menu in place of a
// real profile photo (none of the seeded/demo accounts have one).
export function Avatar({ name, email, size = 32 }) {
  const source = name || email || '?'
  const initials = source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials || '?'}
    </span>
  )
}

const BADGE_STYLES = {
  green: 'bg-emerald-100 text-emerald-700',
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-700',
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-700',
}

export function Badge({ tone = 'slate', children }) {
  return <span className={`badge ${BADGE_STYLES[tone] || BADGE_STYLES.slate}`}>{children}</span>
}

// Maps common status/severity strings from the API to a badge tone.
export function toneForStatus(status) {
  const s = (status || '').toLowerCase()
  if (['success', 'active', 'ok', 'connected', 'succeeded', 'completed'].includes(s)) return 'green'
  if (['failed', 'error', 'blocker', 'revoked', 'suspended'].includes(s)) return 'red'
  if (['pending', 'warning', 'running', 'in_progress', 'past_due'].includes(s)) return 'amber'
  return 'slate'
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
      <svg className="h-4 w-4 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {label}
    </div>
  )
}

export function ErrorBanner({ message = 'Something went wrong.', onRetry }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
      <span>{message}</span>
      {onRetry ? (
        <button onClick={onRetry} className="ml-4 font-semibold underline underline-offset-2">
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
