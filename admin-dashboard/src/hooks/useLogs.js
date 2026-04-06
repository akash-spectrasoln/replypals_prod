import { useQuery } from '@tanstack/react-query'
import { fetchLogs } from '../api/logs'

export function useLogs(params) {
  return useQuery({
    queryKey: ['admin-logs', params],
    queryFn: () => fetchLogs(params),
    staleTime: 15_000,
  })
}
