export function Button({ children, className = '', disabled, variant = 'primary', ...props }) {
  const base =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none'
  const styles =
    variant === 'secondary'
      ? 'bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 focus:ring-slate-400'
      : variant === 'ghost'
        ? 'bg-transparent text-slate-700 hover:bg-slate-100 focus:ring-slate-300'
        : 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500'
  return (
    <button type="button" className={`${base} ${styles} ${className}`} disabled={disabled} {...props}>
      {children}
    </button>
  )
}
