# 🚀 ReplyPals — Setup Guide

Complete guide to get ReplyPals running locally for development and testing.

---

## Prerequisites

- **Python 3.9+**
- **Google Chrome** (for the extension)
- A **Gemini API key** (free at [aistudio.google.com](https://aistudio.google.com)) — or OpenAI/Anthropic key

---

## Step 1: Backend API

### Install Dependencies

```bash
cd api
pip install -r requirements.txt
```

### Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your keys. **Minimum required:**

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | `gemini` (recommended), `openai`, or `anthropic` |
| `GEMINI_API_KEY` | Your Google AI API key |

**For full features (optional):**

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe secret key (see [Stripe Setup](./03-stripe-setup.md)) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_T1_STARTER` through `T6_TEAM` | 18 regional Stripe price IDs |
| `GMAIL_ADDRESS` | Gmail for sending license keys |
| `GMAIL_APP_PASSWORD` | Gmail app password |
| `MIXPANEL_TOKEN` | Mixpanel project token |
| `CRON_SECRET` | Secret for weekly report cron |
| `ADMIN_USERNAME` | Admin dashboard login (default: `admin`) |
| `ADMIN_PASSWORD` | Admin dashboard password |
| `ADMIN_SECRET_KEY` | 64-char JWT signing key |

### Run the Server

```bash
cd api
python main.py
```

The API starts at `http://localhost:8150`. Verify:

```bash
curl http://localhost:8150/health
```

---

## Step 2: Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The onboarding page opens automatically on first install

---

## Step 3: Supabase Database

1. Create a project at [supabase.com](https://supabase.com)
2. Copy your **Project URL** and **Service Role Key** into `.env`
3. Go to **SQL Editor** in Supabase Dashboard
4. Run the SQL from `supabase_core_tables.sql` (creates `free_users`, `licenses`, `teams`, `team_members`, `rewrite_logs`)
5. Also run this for admin panel tables:

```sql
CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT NOT NULL, subject TEXT NOT NULL,
  type TEXT, status TEXT DEFAULT 'sent', error TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT, method TEXT, ip TEXT, plan TEXT,
  status_code INTEGER, latency_ms INTEGER, error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT, details JSONB, ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Step 4: Gmail SMTP

To enable email sending (license keys, welcome emails, weekly reports):

1. Go to [Google Account → Security → 2-Step Verification](https://myaccount.google.com/security)
2. Enable 2-Step Verification if not already
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Create an app password for "Mail"
5. Paste in `.env`:

```bash
GMAIL_ADDRESS=your@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

---

## Step 5: Admin Dashboard

Access at `http://localhost:8150/admin` after starting the API.

Default credentials:
```
Username: admin
Password: changeme123!
```

> ⚠️ Change the password immediately in the Security tab!

---

## Verification Checklist

- [ ] `curl http://localhost:8150/health` returns `{"status": "ok"}`
- [ ] Extension loads in `chrome://extensions` with no errors
- [ ] Onboarding page opens on first install
- [ ] Rewriting text works on any page (Gmail, LinkedIn, etc.)
- [ ] Admin dashboard loads at `/admin`
- [ ] Supabase shows "Connected" in Admin → Settings
