import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      email: null,
      isVerified: false,
      setAuth: (token, email) => set({ token, email, isVerified: true }),
      clearAuth: () => set({ token: null, email: null, isVerified: false }),
      getToken: () => get().token,
    }),
    { name: 'replypal-admin-auth' }
  )
)
