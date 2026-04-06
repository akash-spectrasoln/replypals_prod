import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from '../components/layout/Sidebar'
import { TopBar } from '../components/layout/TopBar'
import { StatsCard } from '../components/ui/StatsCard'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { Button } from '../components/ui/Button'
import { RewritesLineChart } from '../components/charts/RewritesLineChart'
import { PlanBreakdownPieChart } from '../components/charts/PlanBreakdownPieChart'
import { useStats } from '../hooks/useStats'

export function DashboardPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error, refetch } = useStats()

  const errMsg = isError ? error?.message || 'Failed to load stats' : null

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar title="Dashboard" />
        <main className="flex-1 space-y-6 p-6">
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-stats'] })}>
              Refresh
            </Button>
          </div>

          {errMsg ? (
            <ErrorBanner message={errMsg} onRetry={() => refetch()} />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatsCard title="Total Users" value={data?.total_users ?? '—'} loading={isLoading && !data} />
            <StatsCard title="Total Rewrites (all time)" value={data?.total_rewrites ?? '—'} loading={isLoading && !data} />
            <StatsCard title="Rewrites Today" value={data?.rewrites_today ?? '—'} loading={isLoading && !data} />
            <StatsCard title="Rewrites This Month" value={data?.rewrites_this_month ?? '—'} loading={isLoading && !data} />
            <StatsCard title="Active Users Today" value={data?.active_users_today ?? '—'} loading={isLoading && !data} />
            <StatsCard title="Pro Subscribers" value={data?.pro_subscribers ?? '—'} loading={isLoading && !data} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Daily rewrites (30 days)</h2>
              {isLoading && !data ? (
                <div className="h-[280px] animate-pulse rounded bg-slate-100" />
              ) : (
                <RewritesLineChart data={data?.daily_rewrites ?? []} />
              )}
            </section>
            <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Users by plan</h2>
              {isLoading && !data ? (
                <div className="h-[280px] animate-pulse rounded bg-slate-100" />
              ) : (
                <PlanBreakdownPieChart breakdown={data?.plan_breakdown ?? {}} />
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
