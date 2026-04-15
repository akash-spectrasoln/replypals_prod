import { LoadingSkeleton } from './LoadingSkeleton'
import { ErrorBanner } from './ErrorBanner'

export function DataTable({ columns, data, loading, error, onRetry, onSort, emptyMessage, onRowClick, rowKey = 'id' }) {
  if (error) {
    const msg = typeof error === 'string' ? error : error?.message || String(error)
    return <ErrorBanner message={msg} onRetry={onRetry} />
  }

  if (loading) {
    return <LoadingSkeleton rows={6} cols={columns.length} />
  }

  if (!data || data.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-600">{emptyMessage}</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3 font-semibold text-slate-700">
                {col.sortable ? (
                  <button
                    type="button"
                    className="font-semibold text-indigo-700 hover:underline"
                    onClick={() => onSort?.(col.key)}
                  >
                    {col.label}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {data.map((row, idx) => (
            <tr
              key={row[rowKey] ?? idx}
              tabIndex={0}
              className={onRowClick ? 'cursor-pointer hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none' : ''}
              onClick={() => onRowClick?.(row)}
              onKeyDown={(e) => {
                if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  onRowClick(row)
                }
              }}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-2 text-slate-800">
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
