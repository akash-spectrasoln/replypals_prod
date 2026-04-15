import { http, HttpResponse } from 'msw'

/** Match `/api` + path for any origin (Vitest / dev). @param {string} path e.g. '/admin/me' */
export function apiPath(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  return ({ request }) => new URL(request.url).pathname === `/api${p}`
}

export function apiPathUserDetail() {
  return ({ request }) => /^\/api\/admin\/users\/[^/]+$/.test(new URL(request.url).pathname)
}

export const mockStats = {
  total_users: 1200,
  total_rewrites: 50000,
  rewrites_today: 400,
  rewrites_this_month: 9000,
  active_users_today: 80,
  pro_subscribers: 42,
  daily_rewrites: Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 2, 1 + i))
    return { date: d.toISOString().slice(0, 10), count: 10 + i }
  }),
  plan_breakdown: { anon: 100, free: 800, pro: 250, team: 50 },
}

export const mockUsers = {
  users: [
    {
      user_id: 'u1',
      email: 'a@test.com',
      plan: 'free',
      rewrites_this_month: 3,
      total_rewrites: 10,
      joined_date: '2025-01-01',
      last_active: '2026-04-01',
      status: 'active',
    },
    {
      user_id: 'u2',
      email: 'b@test.com',
      plan: 'pro',
      rewrites_this_month: 100,
      total_rewrites: 500,
      joined_date: '2025-02-01',
      last_active: '2026-04-02',
      status: 'active',
    },
  ],
  total: 2,
  page: 1,
  pages: 1,
}

export const mockLogs = {
  logs: [
    {
      timestamp: '2026-04-01T12:00:00Z',
      email: 'x@test.com',
      mode: 'rewrite',
      tone: 'neutral',
      score: 0,
      status: 'success',
      duration_ms: 120,
    },
  ],
  total: 1,
  page: 1,
  pages: 1,
}

export const mockSettings = {
  free_monthly_limit: 10,
  anon_limit: 3,
  model: 'gemini::gemini-1.5-flash',
  maintenance_mode: false,
}

export const handlers = [
  http.post(apiPath('/admin/login'), async () =>
    HttpResponse.json({ token: 'tok', email: 'admin@test.com', expires_at: '2026-04-06T00:00:00Z' })
  ),
  http.get(apiPath('/admin/me'), () => HttpResponse.json({ email: 'admin@test.com', role: 'admin' })),
  http.get(apiPath('/admin/stats'), () => HttpResponse.json(mockStats)),
  http.get(apiPath('/admin/users'), ({ request }) => {
    const url = new URL(request.url)
    const search = (url.searchParams.get('search') || '').toLowerCase()
    const plan = url.searchParams.get('plan') || 'all'
    let users = [...mockUsers.users]
    if (search) users = users.filter((u) => u.email.toLowerCase().includes(search))
    if (plan !== 'all') users = users.filter((u) => u.plan === plan)
    return HttpResponse.json({ ...mockUsers, users, total: users.length, pages: 1 })
  }),
  http.get(apiPathUserDetail(), () =>
    HttpResponse.json({
      user_id: 'u1',
      email: 'a@test.com',
      profile: { created_at: '2025-01-01', last_seen: '2026-04-01' },
      api_logs: [{ created_at: '2026-04-01', action: 'rewrite', status: 'success' }],
    })
  ),
  http.get(apiPath('/admin/logs'), ({ request }) => {
    const url = new URL(request.url)
    url.searchParams.get('from')
    url.searchParams.get('to')
    url.searchParams.get('mode')
    url.searchParams.get('status')
    return HttpResponse.json(mockLogs)
  }),
  http.get(apiPath('/admin/settings'), () => HttpResponse.json({ ...mockSettings, app_settings: {} })),
  http.patch(apiPath('/admin/settings'), async () => HttpResponse.json(mockSettings)),
]

export const loginErrorHandler = http.post(apiPath('/admin/login'), () => HttpResponse.json({ detail: 'no' }, { status: 401 }))

export const statsErrorHandler = http.get(apiPath('/admin/stats'), () => HttpResponse.json({ err: true }, { status: 500 }))

export const usersErrorHandler = http.get(apiPath('/admin/users'), () => HttpResponse.json({ err: true }, { status: 500 }))

export const logsErrorHandler = http.get(apiPath('/admin/logs'), () => HttpResponse.json({ err: true }, { status: 500 }))
