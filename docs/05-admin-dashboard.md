# 🛡️ ReplyPals — Admin Dashboard

A secure, password-protected web app for managing everything from one place.

---

## Access

```
Development:  http://localhost:8150/admin
Production:   https://your-api.railway.app/admin
```

Default credentials: `admin` / `changeme123!`

---

## Architecture

| Component | File | Tech |
|-----------|------|------|
| Admin Routes | `api/admin_routes.py` | FastAPI + PyJWT |
| Admin HTML | `api/admin/index.html` | Tailwind CSS CDN |
| Admin JS (Core) | `api/admin/admin.js` | Vanilla JS + Chart.js |
| Admin JS (Pages) | `api/admin/admin_pages.js` | Vanilla JS |

---

## 9 Pages

| Page | Features |
|------|----------|
| **📊 Dashboard** | 4 stat cards (users, licenses, rewrites today, avg score), line chart, doughnut chart, recent activity |
| **👥 Users** | Searchable, sortable, paginated table with view/email/delete actions, CSV export |
| **🔑 Licenses** | CRUD, manual creation, toggle active/revoked, resend email, stats bar |
| **👔 Teams** | Expandable rows with members, edit name/seats/brand voice, delete |
| **📈 Analytics** | 5 charts (rewrites over time, new users, score distribution, tone usage, top patterns), 7/30/90 day range |
| **📧 Emails** | Email log table, bulk announcement sender with real-time progress |
| **📋 Logs** | Real-time API request logs with auto-refresh, filter by errors/slow/endpoint |
| **⚙️ Settings** | AI provider keys, Supabase status, Stripe status, Regional pricing table with preview, Email config, App settings, Danger zone |
| **🔒 Security** | Password change, active session management, blocked IPs, audit log |

---

## Authentication

- **JWT tokens** with 8-hour expiry, stored in `sessionStorage`
- `secrets.compare_digest()` for timing-safe password comparison
- 1-second artificial delay on failed logins
- **IP blocking** after 5 failed attempts in 15 minutes
- Optional IP restriction via `ADMIN_ALLOWED_IP` env var
- All admin mutations logged to `admin_audit_log` table

---

## Environment Variables

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password          # min 12 chars recommended
ADMIN_SECRET_KEY=random_64_char_string       # for JWT signing
ADMIN_ALLOWED_IP=                            # optional, blank = allow all
```

---

## Security Highlights

- API keys are **never returned in full** (always masked with `•••••`)
- All dangerous operations (clear logs, revoke all) require typing `CONFIRM`
- Admin audit log is **append-only** (cannot be deleted from UI)
- JWT stored in `sessionStorage` (clears when tab closes)
- Request logging middleware excludes admin and health endpoints
