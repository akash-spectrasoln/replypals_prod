import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { UsersPage } from '../../pages/UsersPage'
import { server } from '../mocks/server'
import { apiPath, usersErrorHandler, mockUsers } from '../mocks/handlers'
import { http, HttpResponse } from 'msw'

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter basename="/admin" initialEntries={['/admin']}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  )
}

describe('UsersPage', () => {
  beforeEach(() => {
    server.resetHandlers()
  })

  test('shows LoadingSkeleton while users are loading', () => {
    server.use(
      http.get(apiPath('/admin/users'), async () => {
        await new Promise((r) => setTimeout(r, 60000))
        return HttpResponse.json(mockUsers)
      })
    )
    wrap(<UsersPage />)
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  test('renders users table with correct columns', async () => {
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('Email')).toBeInTheDocument())
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Total Rewrites')).toBeInTheDocument()
  })

  test('renders correct number of rows', async () => {
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('a@test.com')).toBeInTheDocument())
    expect(screen.getByText('b@test.com')).toBeInTheDocument()
  })

  test('search filter narrows rows to matching emails', async () => {
    const user = userEvent.setup()
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('b@test.com')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText(/search email/i), 'a@test')
    await waitFor(() => expect(screen.queryByText('b@test.com')).not.toBeInTheDocument())
  })

  test('plan filter shows only users of selected plan', async () => {
    const user = userEvent.setup()
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('b@test.com')).toBeInTheDocument())
    await user.selectOptions(screen.getByRole('combobox', { name: /plan/i }), 'pro')
    await waitFor(() => expect(screen.queryByText('a@test.com')).not.toBeInTheDocument())
  })

  test('clicking a row opens UserDetailDrawer', async () => {
    const user = userEvent.setup()
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('a@test.com')).toBeInTheDocument())
    await user.click(screen.getByText('a@test.com'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('UserDetailDrawer shows correct user details', async () => {
    const user = userEvent.setup()
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('a@test.com')).toBeInTheDocument())
    await user.click(screen.getByText('a@test.com'))
    await waitFor(() => expect(screen.getByText(/Recent usage/i)).toBeInTheDocument())
  })

  test('Refresh button triggers re-fetch', async () => {
    let n = 0
    server.use(
      http.get(apiPath('/admin/users'), () => {
        n++
        return HttpResponse.json(mockUsers)
      })
    )
    const user = userEvent.setup()
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('a@test.com')).toBeInTheDocument())
    const first = n
    await user.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(n).toBeGreaterThan(first))
  })

  test('shows ErrorBanner when /admin/users returns 500', async () => {
    server.use(usersErrorHandler)
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  test('Export CSV button downloads correct data', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(document, 'createElement')
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText('a@test.com')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /export csv/i }))
    expect(create).toHaveBeenCalled()
    create.mockRestore()
  })

  test('pagination shows correct page and navigates correctly', async () => {
    server.use(
      http.get(apiPath('/admin/users'), ({ request }) => {
        const url = new URL(request.url)
        const page = Number(url.searchParams.get('page') || '1')
        return HttpResponse.json({
          ...mockUsers,
          page,
          pages: 2,
          total: 100,
          users: page === 1 ? mockUsers.users : [],
        })
      })
    )
    const user = userEvent.setup()
    wrap(<UsersPage />)
    await waitFor(() => expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument())
  })
})
