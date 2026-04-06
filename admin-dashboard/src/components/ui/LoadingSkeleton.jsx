export function LoadingSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="w-full animate-pulse space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="h-8 flex-1 rounded bg-slate-200" />
          ))}
        </div>
      ))}
    </div>
  )
}
