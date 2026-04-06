import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../../pages/LoginPage'
import { useAuthStore } from '../../store/authStore'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { apiPath, loginErrorHandler } from '../mocks/handlers'

describe('LoginPage', () => {
  beforeEach(() => {
    server.resetHandlers()
    localStorage.clear()
    useAuthStore.persist.clearStorage()
    useAuthStore.getState().clearAuth()
  })

  test('renders email and password fields', () => {
    render(
      <MemoryRouter basename="/admin" initialEntries={['/admin/login']}>
        <LoginPage />
      </MemoryRouter>
    )
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  test('submit button is disabled while submitting', async () => {
    server.use(
      http.post(apiPath('/admin/login'), async () => {
        await new Promise((r) => setTimeout(r, 400))
        return HttpResponse.json({ detail: 'bad' }, { status: 401 })
      })
    )
    const user = userEvent.setup()
    render(
      <MemoryRouter basename="/admin" initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div />} />
        </Routes>
      </MemoryRouter>
    )
    await user.type(screen.getByLabelText(/email/i), 'a@b.com')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
  })

  test('successful login stores token in authStore and navigates to /', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter basename="/admin" initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div data-testid="home">Home</div>} />
        </Routes>
      </MemoryRouter>
    )
    await user.type(screen.getByLabelText(/email/i), 'a@b.com')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
    const stored = localStorage.getItem('replypal-admin-auth')
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored).state.token).toBe('tok')
  })

  test('failed login shows inline error message', async () => {
    server.use(loginErrorHandler)
    const user = userEvent.setup()
    render(
      <MemoryRouter basename="/admin" initialEntries={['/admin/login']}>
        <LoginPage />
      </MemoryRouter>
    )
    await user.type(screen.getByLabelText(/email/i), 'a@b.com', { delay: null })
    await user.type(document.getElementById('password'), 'wrong', { delay: null })
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  test('already logged in user is redirected to / without seeing login form', async () => {
    useAuthStore.getState().setAuth('x', 'a@b.com')
    render(
      <MemoryRouter basename="/admin" initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div data-testid="home">Home</div>} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument())
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  test('shows loading state on submit button while request is in flight', async () => {
    server.use(
      http.post(apiPath('/admin/login'), async () => {
        await new Promise((r) => setTimeout(r, 400))
        return HttpResponse.json({ detail: 'bad' }, { status: 401 })
      })
    )
    const user = userEvent.setup()
    render(
      <MemoryRouter basename="/admin" initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div />} />
        </Routes>
      </MemoryRouter>
    )
    await user.type(screen.getByLabelText(/email/i), 'a@b.com')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(screen.getByRole('button', { name: /signing in/i })).toBeInTheDocument()
  })
})
