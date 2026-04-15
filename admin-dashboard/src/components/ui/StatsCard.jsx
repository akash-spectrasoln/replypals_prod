import { LoadingSkeleton } from './LoadingSkeleton'

export function StatsCard({ title, value, delta, deltaLabel, loading }) {
  if (loading) {
    return (
      <section
        role="region"
        aria-label={title}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <LoadingSkeleton rows={2} cols={1} />
      </section>
    )
  }

  const positive = delta != null && delta > 0
  const negative = delta != null && delta < 0

  return (
    <section role="region" aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {delta != null && deltaLabel ? (
        <p
          className={`mt-1 flex items-center gap-1 text-sm font-medium ${
            positive ? 'text-emerald-600' : negative ? 'text-red-600' : 'text-slate-600'
          }`}
        >
          <span aria-hidden>{positive ? '↑' : negative ? '↓' : '—'}</span>
          <span>
            {delta > 0 ? '+' : ''}
            {delta} {deltaLabel}
          </span>
        </p>
      ) : null}
    </section>
  )
}
