# Test everything + market ReplyPals (simple playbook)

You do **not** need to be a QA engineer or marketer. Follow this in order.

---

## Part A — Test everything (about 2 hours first time)

### Level 1 — No server, no money (10 minutes)

Runs logic tests only. Do this after every code change.

**Windows (PowerShell):**

```powershell
cd "path\to\replypals_prod-main"
.\scripts\smoke-test-local.ps1
```

**Or manually:**

```powershell
node tests/extension/test_extension.js
node tests/extension/test_quota_merge.js
node tests/extension/test-logic.js
node tests/extension/test_background_format.js
pytest tests/unit/ -v
cd website; npm test
cd ..\admin-dashboard; npm test
```

**Pass =** all show `0 failed` / pytest green.

---

### Level 2 — Local full app (45 minutes)

**Terminal 1 — start API:**

```powershell
cd api
python main.py
```

Wait until you see the server on `http://127.0.0.1:8150`.

**Terminal 2 — automated API tests:**

```powershell
$env:REPLYPALS_API_URL = "http://127.0.0.1:8150"
pytest tests/api/test_api.py -v -m "not ai"
```

Many tests should run (not skip). Fix `.env` if health checks fail.

**Terminal 3 — extension in Chrome:**

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/` folder.
2. Open [Gmail](https://mail.google.com) or any text box.
3. Select text → use ReplyPals icon / side panel → **Rewrite**.
4. Repeat until you hit the **anon limit (3)** → should prompt sign up.
5. Open `http://127.0.0.1:8150/signup` → create account → connect extension from dashboard.

**Manual checklist (tick each box):**

| # | Area | What to do | Pass? |
|---|------|------------|-------|
| 1 | API | Browser: `http://127.0.0.1:8150/health` → `status: ok` | ☐ |
| 2 | Website | `http://127.0.0.1:8150/` loads | ☐ |
| 3 | Signup | `/signup` → email signup works | ☐ |
| 4 | Login | `/login` → sign in works | ☐ |
| 5 | Dashboard | `/dashboard` → shows plan + usage numbers | ☐ |
| 6 | Extension | Rewrite on Gmail/LinkedIn works | ☐ |
| 7 | Limits | 3 anon tries block; free account shows ~10/mo | ☐ |
| 8 | Admin | `http://127.0.0.1:8150/admin/` → login with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env` | ☐ |
| 9 | Pricing | Extension upgrade screen OR dashboard upgrade loads prices | ☐ |
| 10 | Stripe | Use [Stripe test card](https://docs.stripe.com/testing) `4242…` on checkout (test mode keys in `.env`) | ☐ |

---

### Level 3 — One AI rewrite (optional, uses API quota)

```powershell
$env:RUN_COSTLY_TESTS = "1"
$env:REPLYPALS_API_URL = "http://127.0.0.1:8150"
pytest tests/e2e/test_quota_billing_e2e.py -v -m costly
```

Or manually: one rewrite in the extension and confirm `/free-usage` count goes up in dashboard.

---

### Level 4 — Production smoke (after Render deploy)

Replace URL with your `*.onrender.com` (or custom domain):

```powershell
$env:REPLYPALS_API_URL = "https://YOUR-SERVICE.onrender.com"
pytest tests/e2e/test_quota_billing_e2e.py -v -m "not costly"
```

**Browser:** same checklist as Level 2, but on your live URL.

**Cold start:** Render free tier sleeps after 15 min idle — first request may take ~1 minute. That is normal on free tier.

---

## Part B — Market ReplyPals (without a marketing budget)

### Who this is for (say this clearly everywhere)

> Non-native English speakers who write emails, WhatsApp, LinkedIn, and job applications and want to sound natural in one click.

**Not for:** “everyone who uses ChatGPT.” Narrow wins.

---

### Week 1 — Proof it works (no ads)

| Day | Action |
|-----|--------|
| 1 | Record a **60-second screen recording**: bad English → select → ReplyPals rewrite → paste back. No face required. |
| 2 | Post on **LinkedIn** + **X** with that video. Caption: “Built for people who think in Hindi/Tamil/Arabic but write in English.” |
| 3 | Post in **2 communities** (pick one): r/IndianWorkplace, r/EnglishLearning, r/freelance, Facebook “Jobs abroad” groups. **Ask for feedback**, not “buy now.” |
| 4 | Ask **5 friends** who write emails in English to use it 3 days; fix what they complain about. |
| 5 | Publish extension to **Chrome Web Store** (unlisted first if nervous). Copy: `docs/chrome-web-store-listing.md`. |

---

### Week 2 — First real users

| Action | Why |
|--------|-----|
| **Free tier** stays generous for trials | 3 anon + 10/mo signed-in is your hook |
| **One landing line** on site | “Sound natural in English — in one click, inside Gmail & LinkedIn.” |
| **Referral** (already in app) | Ask happy users to share; both get bonus rewrites |
| **Collect emails** on dashboard | Weekly report feature = reason to return |

**Do not:** spend on ads until 20 people use it weekly without you asking.

---

### Channels that fit ReplyPals (ranked)

1. **Chrome Web Store** — main distribution; SEO inside store matters (keywords: rewrite English, email tone, non-native).
2. **Short video** (Reels / Shorts / TikTok) — before/after one sentence.
3. **LinkedIn** — professionals + job seekers in India, Philippines, MENA.
4. **WhatsApp / Telegram groups** — job hunters, remote work (share link, not spam).
5. **Partners** — English tutors, immigration consultants (affiliate later).

---

### Message templates (copy-paste)

**LinkedIn post:**

```
I built ReplyPals — a Chrome extension that rewrites your English to sound confident/polite/formal in one click.

Made for people who are great at their job but English email takes forever.

Free to try (no credit card). Would love 3 minutes of feedback from anyone who writes emails daily.
→ [your link]
```

**Feedback ask (DM / comment reply):**

```
What site do you write on most (Gmail, LinkedIN, WhatsApp Web)?
Did the rewrite feel natural or too formal?
Would you pay $9/mo for unlimited?
```

---

### What to measure (simple spreadsheet)

| Metric | Goal (month 1) |
|--------|----------------|
| Extension installs | 50 |
| People who complete 1+ rewrite | 30 |
| Signups (free account) | 15 |
| Paid (if Stripe live) | 2–3 |

Check **admin dashboard** → users, rewrites today, plan breakdown.

---

## Single global price (launch mode)

Pricing is set to **one USD price for all countries** (Pro **$9/mo**). To re-apply after resetting Supabase:

```powershell
python scripts/apply_single_global_pricing.py
```

Set `PRICING_MODE=global` in `api/.env`. To turn regional PPP back on later, set `pricing_mode` to `regional` in `system_config` and restore `country_pricing` multipliers in admin.

---

## Part C — When something breaks

| Symptom | Likely fix |
|---------|------------|
| Extension “offline” | API down or wrong `API_BASE`; rebuild extension with correct `REPLYPAL_API_URL` |
| Rewrite 429 / limit | Expected at cap; test with new anon id or new email |
| Dashboard blank | Supabase keys in `.env`; check browser console |
| Stripe fails | Test keys + webhook URL on Render |
| Render slow first load | Free tier cold start; upgrade to Starter ($7) when serious |

---

## Quick links in this repo

| Doc | Use |
|-----|-----|
| [01-setup-guide.md](01-setup-guide.md) | First-time install |
| [09-free-hosting.md](09-free-hosting.md) | Deploy to Render |
| [chrome-web-store-listing.md](chrome-web-store-listing.md) | Store copy |
| [03-stripe-setup.md](03-stripe-setup.md) | Payments |

---

## Minimum “I’m ready to launch” bar

- [ ] Level 1 tests pass  
- [ ] Level 2 manual checklist all ticked locally  
- [ ] Deployed to Render with env vars set  
- [ ] Extension built with production API URL  
- [ ] 60-second demo video recorded  
- [ ] Posted once publicly asking for feedback  

You do not need perfection. You need **10 real users** who come back without you reminding them.
