import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { LogsPage } from '../../pages/LogsPage'
import { server } from '../mocks/server'
import { apiPath, logsErrorHandler, mockLogs } from '../mocks/handlers'
import { http, HttpResponse } from 'msw'

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter basename="/admin" initialEntries={['/admin']}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  )
}

describe('LogsPage', () => {
  beforeEach(() => {
    server.resetHandlers()
  })

  test('shows LoadingSkeleton while logs are loading', () => {
    server.use(
      http.get(apiPath('/admin/logs'), async () => {
        await new Promise((r) => setTimeout(r, 60000))
        return HttpResponse.json(mockLogs)
      })
    )
    wrap(<LogsPage />)
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  test('renders logs table with correct columns', async () => {
    wrap(<LogsPage />)
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Timestamp' })).toBeInTheDocument())
    expect(screen.getByRole('columnheader', { name: 'User Email' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Mode' })).toBeInTheDocument()
  })

  test('date range filter sends correct params to API', async () => {
    let captured = ''
    server.use(
      http.get(apiPath('/admin/logs'), ({ request }) => {
        captured = request.url
        return HttpResponse.json(mockLogs)
      })
    )
    const user = userEvent.setup()
    wrap(<LogsPage />)
    await waitFor(() => expect(screen.getByText('x@test.com')).toBeInTheDocument())
    const from = document.getElementById('logs-from')
    await user.clear(from)
    await user.type(from, '2026-01-01')
    await waitFor(() => expect(captured).toContain('from=2026-01-01'))
  })

  test('mode filter sends correct params to API', async () => {
    let captured = ''
    server.use(
      http.get(apiPath('/admin/logs'), ({ request }) => {
        captured = request.url
        return HttpResponse.json(mockLogs)
      })
    )
    const user = userEvent.setup()
    wrap(<LogsPage />)
    await waitFor(() => expect(screen.getByText('x@test.com')).toBeInTheDocument())
    const mode = screen.getByPlaceholderText(/e\.g\. rewrite/i)
    await user.type(mode, 'rewrite')
    await waitFor(() => expect(captured).toContain('mode=rewrite'))
  })

  test('status filter sends correct params to API', async () => {
    let captured = ''
    server.use(
      http.get(apiPath('/admin/logs'), ({ request }) => {
        captured = request.url
        return HttpResponse.json(mockLogs)
      })
    )
    const user = userEvent.setup()
    wrap(<LogsPage />)
    await waitFor(() => expect(screen.getByText('x@test.com')).toBeInTheDocument())
    await user.selectOptions(screen.getByRole('combobox', { name: /status/i }), 'success')
    await waitFor(() => expect(captured).toContain('status=success'))
  })

  test('pagination navigates correctly', async () => {
    server.use(
      http.get(apiPath('/admin/logs'), ({ request }) => {
        const url = new URL(request.url)
        const page = Number(url.searchParams.get('page') || '1')
        return HttpResponse.json({ ...mockLogs, page, pages: 2, total: 100 })
      })
    )
    const user = userEvent.setup()
    wrap(<LogsPage />)
    await waitFor(() => expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument())
  })

  test('shows ErrorBanner when /admin/logs returns 500', async () => {
    server.use(logsErrorHandler)
    wrap(<LogsPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
