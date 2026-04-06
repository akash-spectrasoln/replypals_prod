import { useState } from 'react'
import { Sidebar } from '../components/layout/Sidebar'
import { TopBar } from '../components/layout/TopBar'
import { DataTable } from '../components/ui/DataTable'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { useLogs } from '../hooks/useLogs'

export function LogsPage() {
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const params = { page, limit: 50, mode, status, from, to }
  const { data, isLoading, isError, error, refetch } = useLogs(params)

  const columns = [
    {
      key: 'timestamp',
      label: 'Timestamp',
      render: (r) => r.timestamp || r.created_at,
    },
    { key: 'email', label: 'User Email' },
    { key: 'mode', label: 'Mode', render: (r) => r.mode || r.action },
    { key: 'tone', label: 'Tone' },
    { key: 'score', label: 'Score' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'success' ? 'success' : 'danger'}>{r.status}</Badge>
      ),
    },
    { key: 'duration_ms', label: 'Duration', render: (r) => `${r.duration_ms ?? r.latency_ms ?? '—'} ms` },
  ]

  const rows = (data?.logs ?? []).map((r) => ({
    ...r,
    timestamp: r.timestamp || r.created_at,
    mode: r.mode || r.action,
    duration_ms: r.duration_ms ?? r.latency_ms,
  }))

  const pages = data?.pages ?? 1

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar title="Rewrite logs" />
        <main className="flex-1 space-y-4 p-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="logs-from" className="block text-xs font-medium text-slate-600">
                From
              </label>
              <input
                id="logs-from"
                type="date"
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div>
              <label htmlFor="logs-to" className="block text-xs font-medium text-slate-600">
                To
              </label>
              <input
                id="logs-to"
                type="date"
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div>
              <label htmlFor="logs-mode" className="block text-xs font-medium text-slate-600">
                Mode
              </label>
              <input
                id="logs-mode"
                type="text"
                placeholder="e.g. rewrite"
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div>
              <label htmlFor="logs-status" className="block text-xs font-medium text-slate-600">
                Status
              </label>
              <select
                id="logs-status"
                aria-label="Status filter"
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={rows}
            loading={isLoading}
            error={isError ? error : null}
            onRetry={() => refetch()}
            emptyMessage="No logs for the selected filters."
          />

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              Page {data?.page ?? page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
