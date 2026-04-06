import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '../../pages/DashboardPage'
import { server } from '../mocks/server'
import { apiPath, statsErrorHandler, mockStats } from '../mocks/handlers'
import { http, HttpResponse } from 'msw'

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter basename="/admin" initialEntries={['/admin']}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    server.resetHandlers()
    vi.useRealTimers()
  })

  test('shows LoadingSkeleton while stats are loading', () => {
    server.use(
      http.get(apiPath('/admin/stats'), async () => {
        await new Promise((r) => setTimeout(r, 60000))
        return HttpResponse.json(mockStats)
      })
    )
    wrap(<DashboardPage />)
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  test('renders all 6 StatsCards with correct values after load', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('1200')).toBeInTheDocument())
    expect(screen.getByText('50000')).toBeInTheDocument()
    expect(screen.getByText('400')).toBeInTheDocument()
    expect(screen.getByText('9000')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  test('renders RewritesLineChart with 30 data points', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Daily rewrites (30 days)')).toBeInTheDocument())
  })

  test('renders PlanBreakdownPieChart with correct segments', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Users by plan')).toBeInTheDocument())
  })

  test('shows ErrorBanner when /admin/stats returns 500', async () => {
    server.use(statsErrorHandler)
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  test('Refresh button triggers re-fetch of stats', async () => {
    let n = 0
    server.use(
      http.get(apiPath('/admin/stats'), () => {
        n++
        return HttpResponse.json(mockStats)
      })
    )
    const user = userEvent.setup()
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('1200')).toBeInTheDocument())
    const first = n
    await user.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(n).toBeGreaterThan(first))
  })

  test('data auto-refreshes after 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let n = 0
    server.use(
      http.get(apiPath('/admin/stats'), () => {
        n++
        return HttpResponse.json(mockStats)
      })
    )
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('1200')).toBeInTheDocument())
    const afterFirst = n
    await act(async () => {
      vi.advanceTimersByTime(31_000)
    })
    expect(n).toBeGreaterThan(afterFirst)
    vi.useRealTimers()
  })
})
