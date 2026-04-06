import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from '../components/layout/Sidebar'
import { TopBar } from '../components/layout/TopBar'
import { DataTable } from '../components/ui/DataTable'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { useUsers } from '../hooks/useUsers'
import { fetchUserDetail } from '../api/users'

function UserDetailDrawer({ user, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-user-detail', user?.user_id],
    queryFn: () => fetchUserDetail(user.user_id),
    enabled: Boolean(user?.user_id),
  })

  if (!user) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold">User details</h2>
          <button type="button" className="rounded p-2 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="space-y-4 p-4 text-sm">
          <p>
            <span className="font-medium text-slate-600">Email:</span> {user.email}
          </p>
          <p>
            <span className="font-medium text-slate-600">Plan:</span> {user.plan}
          </p>
          <p>
            <span className="font-medium text-slate-600">Status:</span> {user.status}
          </p>
          {isLoading ? <p className="text-slate-500">Loading history…</p> : null}
          {error ? <p className="text-red-600">{error.message}</p> : null}
          {data ? (
            <>
              <p>
                <span className="font-medium text-slate-600">Joined:</span>{' '}
                {data.profile?.created_at || data.joined || '—'}
              </p>
              <p>
                <span className="font-medium text-slate-600">Last active:</span>{' '}
                {data.profile?.last_seen || data.last_active || '—'}
              </p>
              <div>
                <p className="font-medium text-slate-700">Recent usage</p>
                <ul className="mt-2 max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-slate-700">
                  {(data.api_logs || data.logs || []).slice(0, 50).map((log, i) => (
                    <li key={i}>
                      {log.created_at || log.timestamp} — {log.action || log.mode} ({log.status})
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [plan, setPlan] = useState('all')
  const [sortKey, setSortKey] = useState('email')
  const [selected, setSelected] = useState(null)

  const { data, isLoading, isError, error, refetch } = useUsers({ page, limit: 50, plan, search })

  const rows = useMemo(() => {
    const u = data?.users ?? []
    const sorted = [...u].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      return String(av).localeCompare(String(bv), undefined, { numeric: true })
    })
    return sorted
  }, [data, sortKey])

  function exportCsv() {
    const cols = ['email', 'plan', 'rewrites_this_month', 'total_rewrites', 'joined_date', 'last_active', 'status']
    const header = cols.join(',')
    const lines = rows.map((r) =>
      cols
        .map((c) => {
          const v = r[c] ?? ''
          const s = String(v).replace(/"/g, '""')
          return `"${s}"`
        })
        .join(',')
    )
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'users-export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const columns = [
    { key: 'email', label: 'Email', sortable: true },
    {
      key: 'plan',
      label: 'Plan',
      sortable: true,
      render: (r) => <Badge tone="info">{r.plan}</Badge>,
    },
    { key: 'rewrites_this_month', label: 'Rewrites This Month', sortable: true },
    { key: 'total_rewrites', label: 'Total Rewrites', sortable: true },
    { key: 'joined_date', label: 'Joined Date', sortable: true },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>,
    },
  ]

  const pages = data?.pages ?? 1

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar title="Users" />
        <main className="flex-1 space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Search email…"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
            <select
              aria-label="Plan filter"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All plans</option>
              <option value="anon">Anonymous</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="team">Team</option>
            </select>
            <Button type="button" variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-users'] })}>
              Refresh
            </Button>
            <Button type="button" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>

          <DataTable
            columns={columns}
            data={rows}
            loading={isLoading}
            error={isError ? error : null}
            onRetry={() => refetch()}
            emptyMessage="No users match your filters."
            onSort={(col) => setSortKey(col)}
            onRowClick={(row) => setSelected(row)}
            rowKey="user_id"
          />

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              Page {data?.page ?? page} of {pages} ({data?.total ?? 0} users)
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
      {selected ? <UserDetailDrawer user={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}
