import { useAuthStore } from '../store/authStore'

// Dev (Vite): use VITE_API_BASE=/api with proxy so requests hit the FastAPI app.
// Production: empty base so calls go to same-origin /admin/* (not /api/admin/*).
const RAW =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? '/api' : '')
const BASE = RAW.endsWith('/') ? RAW.slice(0, -1) : RAW

function adminBasePath() {
  const u = (import.meta.env.BASE_URL || '/admin/').replace(/\/$/, '')
  if (!u || u === '/') return '/admin'
  return u
}

function adminLoginPath() {
  // HashRouter: only the hash changes for in-app routes; avoids GET /admin/users vs API conflicts.
  return `${adminBasePath()}/#/login`
}

export async function apiRequest(path, options = {}) {
  const token = useAuthStore.getState().getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (res.status === 401) {
    useAuthStore.getState().clearAuth()
    window.location.href = adminLoginPath()
    throw new Error('Session expired')
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body}`)
  }

  return res.json()
}
