# Use replypals.in instead of *.onrender.com

Render always gives you a URL like `https://replypals-prod.onrender.com`.  
You **keep that** for deploys, but users should only see **`https://replypals.in`**.

---

## Step 1 — Add custom domain in Render

1. Open [Render Dashboard](https://dashboard.render.com) → your **replypals** web service.
2. **Settings** → **Custom Domains**.
3. Add:
   - `replypals.in` (primary)
   - `www.replypals.in` (optional; redirects to apex if you enable canonical redirect)
4. Render shows **DNS records** to add at your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.).

Typical setup:

| Type | Name | Value |
|------|------|--------|
| **CNAME** or **ALIAS** | `@` or `replypals.in` | Render’s target (shown in dashboard) |
| **CNAME** | `www` | Same target or `replypals.in` |

Wait until Render shows **Certificate issued** (HTTPS ready). Can take up to an hour.

---

## Step 2 — Render environment variables

In **Environment**, set (replace extension id):

| Variable | Value |
|----------|--------|
| `APP_BASE_URL` | `https://replypals.in` |
| `PUBLIC_API_BASE_URL` | `https://replypals.in/api` |
| `FRONTEND_SUCCESS_URL` | `https://replypals.in/success` |
| `FRONTEND_CANCEL_URL` | `https://replypals.in/dashboard` |
| `ALLOWED_ORIGINS` | `https://replypals.in,https://www.replypals.in,chrome-extension://YOUR_EXT_ID` |
| `CANONICAL_HOST_REDIRECT` | `1` |
| `PRICING_MODE` | `global` |

**Stripe webhook** (Dashboard → Developers → Webhooks):

`https://replypals.in/api/stripe-webhook`

Save → **Manual Deploy** or wait for auto-deploy.

---

## Step 3 — Redirect onrender.com → replypals.in

With `CANONICAL_HOST_REDIRECT=1`, visits to  
`https://replypals-prod.onrender.com/...`  
redirect to  
`https://replypals.in/...`  
(same path).

---

## Step 4 — Extension

Rebuild so API points at your domain:

```powershell
.\scripts\build-extension.ps1 -ApiUrl "https://replypals.in/api"
```

Publish the new zip to Chrome Web Store when ready.

---

## Step 5 — Verify

| URL | Expected |
|-----|----------|
| https://replypals.in/health | `{"status":"ok",...}` |
| https://replypals.in/api/health | same |
| https://replypals.in/pricing | JSON with `"pricing_mode":"global"` |
| https://replypals-prod.onrender.com/ | redirects to replypals.in |

---

## DNS already on another host?

If `replypals.in` currently points to a **different** server (old site), update DNS to Render’s records from Step 1. Until DNS propagates, the old site may still show.

---

## Supabase auth redirect URLs

In **Supabase** → Authentication → URL configuration, add:

- Site URL: `https://replypals.in`
- Redirect URLs: `https://replypals.in/auth-callback`, `https://replypals.in/dashboard`, `https://replypals.in/**`
