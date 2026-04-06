import { apiRequest } from './client'

export function fetchUsers(params) {
  const q = new URLSearchParams()
  q.set('page', String(params.page ?? 1))
  q.set('limit', String(params.limit ?? 50))
  q.set('plan', params.plan ?? 'all')
  if (params.search) q.set('search', params.search)
  return apiRequest(`/admin/users?${q.toString()}`)
}

export function fetchUserDetail(userId) {
  return apiRequest(`/admin/users/${encodeURIComponent(userId)}`)
}
