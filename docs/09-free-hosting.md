# Free hosting (recommended setup)

ReplyPals runs best as **one web service** (FastAPI serves API + dashboard + admin) plus **Supabase** (free DB/auth).

## 1. Supabase (free)

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase_core_tables.sql` in the SQL editor.
3. Copy URL, anon key, service role key, and JWT secret into Render env vars.

## 2. Render (free API + website + admin)

1. Push this repo to GitHub.
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → connect repo (`render.yaml` is included).
3. Or: **New Web Service** → Docker → root `Dockerfile`.
4. Add environment variables from `api/.env.example` (never commit `.env`).

**Required after first deploy:**

| Variable | Example |
|----------|---------|
| `APP_BASE_URL` | `https://replypals-xxxx.onrender.com` |
| `PUBLIC_API_BASE_URL` | `https://replypals-xxxx.onrender.com/api` |
| `ALLOWED_ORIGINS` | `https://replypals-xxxx.onrender.com,chrome-extension://YOUR_ID` |
| `FRONTEND_SUCCESS_URL` | `https://replypals-xxxx.onrender.com/success` |
| `FRONTEND_CANCEL_URL` | `https://replypals-xxxx.onrender.com/dashboard` |
| `GEMINI_API_KEY` | (or other AI provider) |
| `SUPABASE_URL` / keys | from Supabase |
| `ADMIN_PASSWORD` | strong password |
| `ADMIN_SECRET_KEY` | `openssl rand -hex 32` |

**Stripe webhook URL:** `https://YOUR-SERVICE.onrender.com/api/stripe-webhook`

**Health check:** `/health` (extension may call `/api/health` — both work).

**Free tier note:** Service sleeps after ~15 minutes idle; first request may take 30–60s (cold start).

## 3. Extension

Build with your Render URL:

```bash
export REPLYPAL_API_URL="https://YOUR-SERVICE.onrender.com/api"
export MIXPANEL_TOKEN="your_token"
./scripts/build.sh
```

Load `dist/extension` in Chrome or upload the zip to the Web Store.

## 4. Custom domain (optional)

In Render → **Settings** → **Custom Domains** → add `replypals.in`.

Update `APP_BASE_URL`, `PUBLIC_API_BASE_URL`, `ALLOWED_ORIGINS`, Stripe webhook, and rebuild the extension with the new API URL.

Use **apex** `replypals.in` (not `www`) unless you configure SSL for both.

## 5. Full Docker stack (nginx + Astro, optional)

For a VPS or paid container with nginx in front:

```bash
docker run -e FULL_STACK=1 -e PORT=80 --env-file api/.env -p 80:80 replypals
```

Default `docker-entrypoint.sh` runs **uvicorn only** (best for Render/Railway).

## Alternatives

| Host | Good for |
|------|----------|
| **Railway** | Same Docker image; `railway.json` included; limited monthly credit |
| **Fly.io** | Small always-on VM; more setup |
| **Cloudflare Pages** | Marketing site only — still need Render/Railway for API |
