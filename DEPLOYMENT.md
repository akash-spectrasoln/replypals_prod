# ReplyPals — Production Deployment Guide

## Pre-flight Checklist

Before deploying, confirm every item:

- [ ] All credentials in `api/.env` are **real and rotated** (see §1)
- [ ] `ADMIN_PASSWORD` is strong and not the default
- [ ] `ADMIN_SECRET_KEY` is a fresh 64-char hex string
- [ ] `APP_ENV=production` is set
- [ ] `ALLOWED_ORIGINS` lists your exact domain (not `*`)
- [ ] Extension built via `scripts/build.sh` with real `MIXPANEL_TOKEN`
- [ ] Stripe webhook endpoint is live and `STRIPE_WEBHOOK_SECRET` matches
- [ ] Supabase tables created (run `supabase_core_tables.sql`)

---

## §1 — Secrets Setup

### Generate required secrets

```bash
# ADMIN_SECRET_KEY — 64 hex chars
openssl rand -hex 32

# CRON_SECRET — random string
openssl rand -hex 16
```

### Rotate credentials from dev (REQUIRED)

The following credentials were previously exposed in the repository and **must be rotated immediately**:

| Credential | Action |
|---|---|
| `GEMINI_API_KEY` | Revoke in Google AI Studio → create new |
| `SUPABASE_SERVICE_KEY` | Rotate in Supabase → Settings → API |
| `SUPABASE_JWT_SECRET` | Rotate in Supabase → Settings → API |
| `GMAIL_APP_PASSWORD` | Revoke in Google Account → Security → App Passwords |
| `ADMIN_PASSWORD` | Change in `.env` |

---

## §2 — API Deployment (Docker / Railway / Render)

### Option A: Docker

```bash
# Build image
docker build -t replypal-api .

# Run with env file
docker run -d \
  --name replypal-api \
  --env-file api/.env \
  -e APP_ENV=production \
  -p 8150:8150 \
  replypal-api
```

### Option B: Railway / Render / Fly.io

1. Push repo to GitHub (ensure `.env` is in `.gitignore`)
2. Connect repo to Railway/Render
3. Set root directory to `.` (Dockerfile is at root)
4. Add all env vars from `api/.env.example` in the dashboard
5. Set `APP_ENV=production`

### Startup validation

On first boot in production, the API validates config and will **refuse to start** if:
- No AI provider key is set
- Supabase is not configured
- Stripe is not configured  
- `ADMIN_PASSWORD` is still the default
- `ALLOWED_ORIGINS` is `*`

---

## §3 — Extension Build & Publish

### Build production extension

```bash
export MIXPANEL_TOKEN="your_mixpanel_token"
export REPLYPAL_API_URL="https://api.replypals.in"

./scripts/build.sh
```

Output: `dist/extension/` — ready to zip and upload.

```bash
cd dist && zip -r replypal-extension-v1.2.0.zip extension/
```

### Chrome Web Store submission

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard)
2. Upload `replypal-extension-v1.2.0.zip`
3. After approval, copy your **Extension ID** from the dashboard
4. Update `EXTENSION_ID_HERE` in all `website/*.html` files
5. Update `externally_connectable` in `extension/manifest.json` if needed

---

## §4 — Stripe Webhook Setup

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://api.replypals.in/stripe-webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
4. Copy the **Signing secret** → set as `STRIPE_WEBHOOK_SECRET` in `.env`

### Regional Price IDs

Create prices in Stripe for each tier × plan combination (18 total):
- Tiers: T1 (USD), T2 (USD reduced), T3 (INR), T4 (PHP), T5 (BRL), T6 (USD low)
- Plans: Starter, Pro, Team
- Set each as a **recurring monthly** subscription

---

## §5 — Supabase Setup

Run migrations in order:

```bash
# 1. Core tables
psql $SUPABASE_DB_URL < supabase_core_tables.sql

# 2. Auth helpers
psql $SUPABASE_DB_URL < docs/supabase-auth-setup.sql

# 3. Any fixes
psql $SUPABASE_DB_URL < docs/supabase-fix.sql
```

### Required tables

| Table | Purpose |
|---|---|
| `licenses` | Paid user license keys |
| `free_users` | Free tier users, referrals, email capture |
| `user_profiles` | Score history and stats |
| `llm_call_logs` | Every AI call — billing source of truth |
| `teams` | Team plan accounts |
| `team_members` | Individual team seat holders |
| `email_log` | Sent email audit trail |
| `app_settings` | Runtime config (active AI model) |

---

## §6 — Cron Job (Weekly Reports)

Set up a cron service (EasyCron, GitHub Actions, etc.) to POST weekly:

```bash
curl -X POST https://api.replypals.in/send-weekly-reports \
  -H "X-Cron-Secret: YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

Recommended schedule: Every Sunday at 9:00 AM UTC.

---

## §7 — CORS Configuration

Set `ALLOWED_ORIGINS` to a comma-separated list:

```
ALLOWED_ORIGINS=https://replypals.in,chrome-extension://YOUR_PUBLISHED_EXTENSION_ID
```

> Note: The Chrome extension ID is only known after Chrome Web Store publication. Update this and redeploy.

---

## §8 — Health Check

```bash
curl https://api.replypals.in/health
# Expected: {"status":"ok","service":"ReplyPals API","version":"1.2.0"}
```

---

## Monitoring Recommendations

- **Uptime**: UptimeRobot or Better Uptime on `/health`
- **Errors**: Sentry (add `sentry-sdk` to `requirements.txt`)
- **Cost tracking**: Monitor `llm_call_logs.cost_usd` via admin dashboard
- **Rate limits**: Watch for 429 spikes in admin → Stats
