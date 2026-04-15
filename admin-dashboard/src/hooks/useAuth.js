import { useAuthStore } from '../store/authStore'

export function useAuth() {
  const token = useAuthStore((s) => s.token)
  const email = useAuthStore((s) => s.email)
  const isVerified = useAuthStore((s) => s.isVerified)
  const setAuth = useAuthStore((s) => s.setAuth)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  return { token, email, isVerified, setAuth, clearAuth }
}
