import { useEffect, useState } from 'react'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from './store/authStore'
import { apiRequest } from './api/client'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { UsersPage } from './pages/UsersPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'

const queryClient = new QueryClient()

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" aria-label="Loading" />
    </div>
  )
}

function AppRoutes() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [checking, setChecking] = useState(true)
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated())

  useEffect(() => {
    if (hydrated) return undefined
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true))
  }, [hydrated])

  useEffect(() => {
    if (!hydrated) return undefined

    async function bootstrap() {
      const token = useAuthStore.getState().getToken()
      useAuthStore.setState({ isVerified: false })
      if (!token) {
        setChecking(false)
        return
      }
      try {
        await apiRequest('/admin/me')
        useAuthStore.setState({ isVerified: true })
      } catch {
        clearAuth()
      } finally {
        setChecking(false)
      }
    }

    bootstrap()
  }, [hydrated, clearAuth])

  if (!hydrated || checking) return <FullPageSpinner />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

const routerBasename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router basename={routerBasename}>
        <AppRoutes />
      </Router>
    </QueryClientProvider>
  )
}
