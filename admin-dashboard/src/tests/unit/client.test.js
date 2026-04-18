import { describe, test, expect, beforeEach, vi } from 'vitest'
import { apiRequest } from '../../api/client'
import { useAuthStore } from '../../store/authStore'

describe('apiRequest', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ token: null, email: null, isVerified: false })
    useAuthStore.persist.clearStorage()
    vi.restoreAllMocks()
  })

  test('includes Authorization header when token exists in store', async () => {
    useAuthStore.getState().setAuth('my-jwt', 'a@b.com')
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    await apiRequest('/admin/me')
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][0]).toBe('/api/admin/me')
    const [, init] = spy.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer my-jwt')
  })

  test('does not include Authorization header when token is null', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    await apiRequest('/admin/me')
    const [, init] = spy.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })

  test('calls clearAuth and redirects on 401 response', async () => {
    useAuthStore.getState().setAuth('bad', 'a@b.com')
    const loc = { href: '' }
    vi.stubGlobal('location', loc)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    await expect(apiRequest('/admin/me')).rejects.toThrow('Session expired')
    expect(useAuthStore.getState().token).toBeNull()
    expect(loc.href).toBe('/admin/#/login')
    vi.unstubAllGlobals()
  })

  test('throws error with status and body on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }))
    await expect(apiRequest('/x')).rejects.toThrow('API error 503: nope')
  })

  test('returns parsed JSON on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    const data = await apiRequest('/ok')
    expect(data).toEqual({ a: 1 })
  })
})
