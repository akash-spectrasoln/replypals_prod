import { apiRequest } from './client'

export function fetchLogs(params) {
  const q = new URLSearchParams()
  q.set('page', String(params.page ?? 1))
  q.set('limit', String(params.limit ?? 50))
  if (params.mode) q.set('mode', params.mode)
  if (params.status) q.set('status', params.status)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  return apiRequest(`/admin/logs?${q.toString()}`)
}

export function fetchSettings() {
  return apiRequest('/admin/settings')
}

export function patchSettings(body) {
  return apiRequest('/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
