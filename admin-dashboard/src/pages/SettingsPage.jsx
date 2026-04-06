import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from 'react-router-dom'
import { Sidebar } from '../components/layout/Sidebar'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/Button'
import { Toast } from '../components/ui/Toast'
import { ErrorBanner } from '../components/ui/ErrorBanner'
import { fetchSettings, patchSettings } from '../api/logs'

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: fetchSettings,
  })

  const [freeMonthly, setFreeMonthly] = useState('10')
  const [anonLimit, setAnonLimit] = useState('3')
  const [model, setModel] = useState('')
  const [maintenance, setMaintenance] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!data) return
    setFreeMonthly(String(data.free_monthly_limit ?? 10))
    setAnonLimit(String(data.anon_limit ?? 3))
    setModel(data.model ?? '')
    setMaintenance(Boolean(data.maintenance_mode))
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: patchSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-settings'], updated)
      setToast('Settings saved')
      setDirty(false)
    },
  })

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname
  )

  useEffect(() => {
    if (blocker.state !== 'blocked') return undefined
    const ok = window.confirm('You have unsaved changes. Leave without saving?')
    if (ok) blocker.proceed()
    else blocker.reset()
    return undefined
  }, [blocker])

  function onFieldChange(setter, value) {
    setter(value)
    setDirty(true)
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar title="Settings" />
        <main className="flex-1 max-w-xl space-y-6 p-6">
          {isError ? <ErrorBanner message={error?.message || 'Failed to load settings'} onRetry={() => refetch()} /> : null}

          {isLoading ? <p className="text-slate-600">Loading settings…</p> : null}

          {!isLoading && !isError ? (
            <form
              className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              onSubmit={(e) => {
                e.preventDefault()
                mutation.mutate({
                  free_monthly_limit: Number(freeMonthly),
                  anon_limit: Number(anonLimit),
                  model,
                  maintenance_mode: maintenance,
                })
              }}
            >
              <div>
                <label className="block text-sm font-medium text-slate-700">Free monthly rewrite limit</label>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={freeMonthly}
                  onChange={(e) => onFieldChange(setFreeMonthly, e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Anonymous rewrite limit</label>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={anonLimit}
                  onChange={(e) => onFieldChange(setAnonLimit, e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">AI model in use</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={model}
                  onChange={(e) => onFieldChange(setModel, e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="maint"
                  type="checkbox"
                  checked={maintenance}
                  onChange={(e) => {
                    setMaintenance(e.target.checked)
                    setDirty(true)
                  }}
                />
                <label htmlFor="maint" className="text-sm font-medium text-slate-700">
                  Maintenance mode
                </label>
              </div>
              <Button type="submit" disabled={mutation.isPending || !dirty}>
                {mutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              {mutation.isError ? (
                <p className="text-sm text-red-600">{mutation.error?.message}</p>
              ) : null}
            </form>
          ) : null}
        </main>
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  )
}
