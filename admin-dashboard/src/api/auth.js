import { apiRequest } from './client'

export function login(email, password) {
  return apiRequest('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function fetchMe() {
  return apiRequest('/admin/me')
}
