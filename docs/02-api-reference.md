# 📡 ReplyPals — API Reference

Base URL: `http://localhost:8150` (development) / `https://your-api.railway.app` (production)

---

## Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/rewrite` | Rewrite text in a tone |
| `POST` | `/generate` | Generate text from prompt |
| `GET` | `/pricing` | Get localized pricing for user's region |
| `POST` | `/create-checkout` | Create Stripe checkout session |
| `POST` | `/stripe-webhook` | Handle Stripe webhook events |
| `POST` | `/verify-license` | Verify a license key |
| `POST` | `/check-usage` | Get usage stats for a license |
| `POST` | `/save-email` | Save free user email |
| `POST` | `/register-referral` | Register a referral |
| `POST` | `/create-team` | Create a team |
| `POST` | `/add-team-member` | Add member to team |
| `GET` | `/team-stats` | Get team stats |
| `POST` | `/send-weekly-reports` | Trigger weekly reports (cron) |

---

## Admin Endpoints (JWT required)

All prefixed with `/admin`. Require `Authorization: Bearer <token>` header.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/login` | Get JWT token |
| `GET` | `/admin/dashboard-stats` | Dashboard stat cards |
| `GET` | `/admin/users` | Paginated users list |
| `DELETE` | `/admin/users/{id}` | Delete user |
| `GET` | `/admin/licenses` | Paginated licenses |
| `POST` | `/admin/licenses` | Create manual license |
| `PATCH` | `/admin/licenses/{id}` | Toggle active |
| `DELETE` | `/admin/licenses/{id}` | Soft delete |
| `POST` | `/admin/licenses/{id}/resend` | Resend email |
| `GET` | `/admin/teams` | Teams with members |
| `PATCH` | `/admin/teams/{id}` | Update team |
| `DELETE` | `/admin/teams/{id}` | Delete team |
| `GET` | `/admin/settings` | Get settings (masked) |
| `PATCH` | `/admin/settings` | Update app settings |
| `PATCH` | `/admin/env-key` | Update env var (temp) |
| `POST` | `/admin/test-key` | Test AI key |
| `GET` | `/admin/test-supabase` | Test DB connection |
| `GET` | `/admin/stripe-status` | Stripe mode check |
| `GET` | `/admin/pricing-preview` | Preview pricing by country |
| `GET` | `/admin/analytics` | Chart data |
| `GET` | `/admin/email-logs` | Email log entries |
| `POST` | `/admin/send-email` | Send single email |
| `POST` | `/admin/send-announcement` | Bulk email |
| `GET` | `/admin/announcement-status/{id}` | Bulk email progress |
| `GET` | `/admin/logs` | API request logs |
| `POST` | `/admin/change-password` | Update admin password |
| `GET/DELETE` | `/admin/sessions` | Session management |
| `GET/DELETE` | `/admin/blocked-ips` | IP blocking |
| `GET` | `/admin/audit-log` | Audit log entries |
| `POST` | `/admin/clear-logs` | Clear all logs |
| `POST` | `/admin/revoke-all-licenses` | Revoke all licenses |
| `GET` | `/admin/export-data` | CSV export |

---

## Key Request/Response Examples

### POST /rewrite
```json
// Request
{
  "text": "I am doing the needful and reverting back",
  "tone": "confident",
  "language": "auto",
  "license_key": "RP-XXXX-XXXX"
}

// Response
{
  "rewritten": "I'll take care of this and get back to you shortly.",
  "score": 92,
  "tip": "Avoid 'doing the needful' — it's an Indianism."
}
```

### GET /pricing
```json
// Response (from India)
{
  "country": "IN",
  "tier": "tier3",
  "currency": "inr",
  "plans": {
    "starter": { "display": "₹149", "per": "/mo", "currency": "inr" },
    "pro":     { "display": "₹329", "per": "/mo", "currency": "inr" },
    "team":    { "display": "₹1,999", "per": "/mo", "currency": "inr" }
  },
  "note": "Pricing adjusted for your region",
  "vpn_detected": false
}
```

### POST /create-checkout
```json
// Request
{
  "email": "user@example.com",
  "plan": "pro",
  "tier": "tier3"
}

// Response
{
  "url": "https://checkout.stripe.com/c/pay/..."
}
```
