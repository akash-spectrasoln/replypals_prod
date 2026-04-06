import { describe, test, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../../store/authStore'

describe('authStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ token: null, email: null, isVerified: false })
    useAuthStore.persist.clearStorage()
  })

  test('initial state has null token and email', () => {
    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().email).toBeNull()
  })

  test('setAuth sets token and email and isVerified=true', () => {
    useAuthStore.getState().setAuth('abc', 'e@x.com')
    expect(useAuthStore.getState().token).toBe('abc')
    expect(useAuthStore.getState().email).toBe('e@x.com')
    expect(useAuthStore.getState().isVerified).toBe(true)
  })

  test('clearAuth resets token, email, isVerified to null/false', () => {
    useAuthStore.getState().setAuth('x', 'y')
    useAuthStore.getState().clearAuth()
    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().email).toBeNull()
    expect(useAuthStore.getState().isVerified).toBe(false)
  })

  test('token persists to localStorage after setAuth', () => {
    useAuthStore.getState().setAuth('persist-token', 'a@b.com')
    const raw = localStorage.getItem('replypal-admin-auth')
    expect(raw).toBeTruthy()
    expect(raw).toContain('persist-token')
  })

  test('token is restored from localStorage on store init', () => {
    useAuthStore.getState().setAuth('restored', 'c@d.com')
    const snap = localStorage.getItem('replypal-admin-auth')
    expect(snap).toBeTruthy()
    const parsed = JSON.parse(snap)
    expect(parsed.state.token).toBe('restored')
  })

  test('clearAuth removes token from localStorage', () => {
    useAuthStore.getState().setAuth('t', 'e@e.com')
    useAuthStore.getState().clearAuth()
    const raw = localStorage.getItem('replypal-admin-auth')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.state.token).toBeNull()
  })
})
