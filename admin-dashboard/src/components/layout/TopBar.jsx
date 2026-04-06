import { useAuthStore } from '../../store/authStore'
import { Button } from '../ui/Button'

export function TopBar({ title }) {
  const email = useAuthStore((s) => s.email)
  const clearAuth = useAuthStore((s) => s.clearAuth)

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-600">{email}</span>
        <Button
          variant="secondary"
          onClick={() => {
            clearAuth()
            window.location.href = '/login'
          }}
        >
          Log out
        </Button>
      </div>
    </header>
  )
}
