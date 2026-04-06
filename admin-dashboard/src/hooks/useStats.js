import { useQuery } from '@tanstack/react-query'
import { fetchStats } from '../api/stats'

export function useStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: fetchStats,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}
