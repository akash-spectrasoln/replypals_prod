import { useQuery } from '@tanstack/react-query'
import { fetchUsers } from '../api/users'

export function useUsers(params) {
  return useQuery({
    queryKey: ['admin-users', params],
    queryFn: () => fetchUsers(params),
    staleTime: 30_000,
  })
}
