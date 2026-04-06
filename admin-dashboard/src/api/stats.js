import { apiRequest } from './client'

export function fetchStats() {
  return apiRequest('/admin/stats')
}
