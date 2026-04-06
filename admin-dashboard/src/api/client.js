import { useAuthStore } from '../store/authStore'

const RAW = import.meta.env.VITE_API_BASE || '/api'
const BASE = RAW.endsWith('/') ? RAW.slice(0, -1) : RAW

function adminBasePath() {
  const u = (import.meta.env.BASE_URL || '/admin/').replace(/\/$/, '')
  if (!u || u === '/') return '/admin'
  return u
}

function adminLoginPath() {
  return `${adminBasePath()}/login`
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
