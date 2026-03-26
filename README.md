# ✍ ReplyPals — Rewrite Anything

> The AI writing assistant built for non-native English speakers.
> Rewrite any text — confident, polite, casual, formal — in one click.

ReplyPals is a Chrome extension + FastAPI backend that helps non-native English speakers sound natural. It detects common non-native patterns (Indianisms, Arabisms, etc.), rewrites text to match the requested tone, and provides a "Native Sound Score" to track improvement over time.

---

## ⚡ Features

### Writing Tools
- **Rewrite** — Select any text in any input field. Click the ReplyPals icon. Choose a tone. Get a native-sounding rewrite instantly
- **Generate** — Write full emails/messages from a short prompt
- **Smart Reply** — Right-click any received message → "Reply with ReplyPals"
- **Template Library** — 25 pre-built templates across 4 categories (Work Emails, Client Communication, Job Hunting, Daily Messages). Fill in a form, pick a tone, generate in one click
- **Tone Memory** — Remembers your preferred tone per website (formal for Gmail, casual for WhatsApp)
- **Multi-language Input** — Paste Hindi, Arabic, Filipino, Portuguese, Spanish, or French text → get English output

### Progress & Insights
- **Native Sound Score** — Every rewrite gets a 0–100 score showing how natural it sounds
- **Progress Card** — Side panel shows weekly averages, improvement trends, and most common issues
- **Weekly Reports** — Email reports with average score, total rewrites, and flagged patterns
- **Diff View** — See exactly what changed between your original and the rewrite

### Privacy & Trust
- **Zero text logging** — No user text is ever stored, logged, or retained by the API
- **Privacy tooltip** — Hover over the ReplyPals icon on any page to see "🔒 Your text is never stored"
- **Privacy bar** — Persistent bar in the side panel linking to the privacy policy
- **Anonymous analytics** — Only metadata (tone, score, feature used) is tracked. Never text content.

### Business Features
- **Pricing Tiers** — FREE (5 rewrites), Starter ($2/mo, 50 rewrites), Pro ($9/mo, unlimited), Team ($25/mo, 5 seats)
- **Stripe Integration** — Full payment flow with checkout sessions and webhook-based license provisioning
- **Team Plan** — Admin dashboard, member invites, shared brand voice, team-wide stats
- **Referral System** — Share a referral link → both users get 5 bonus free rewrites
- **Email Capture** — After 3rd rewrite, users can opt in to weekly progress reports

### Developer Experience
- **Offline Handling** — Graceful degradation when the API is unreachable
- **Error Toasts** — Clear, dismissible error messages for offline, timeout, and server errors
- **Rewrite Cache** — Last 5 rewrites cached locally, visible in a collapsible "Recent" section
- **Mixpanel Analytics** — Track engagement events (no personal data) via HTTP API
- **Onboarding Flow** — 3-step welcome experience on first install

---

## 📁 Project Structure

```
replypal extension/
├── api/
│   ├── main.py               # FastAPI backend — all endpoints
│   ├── requirements.txt       # Python dependencies
│   ├── .env.example           # Environment variable template
│   ├── .env                   # Your local env (not committed)
│   ├── admin_routes.py        # Admin dashboard API (30+ endpoints)
│   └── admin/                 # Admin dashboard frontend (HTML, JS)
├── extension/
│   ├── manifest.json          # Chrome Extension manifest v3
│   ├── background.js          # Service worker — API calls, onboarding, analytics
│   ├── content.js             # Content script — inline icon, popup, rewrite UI
│   ├── popup.html             # Side panel HTML
│   ├── popup.css              # Side panel styles
│   ├── popup.js               # Side panel logic
│   ├── templates.js           # Template library data (25 templates)
│   ├── analytics.js           # Mixpanel HTTP API wrapper
│   ├── onboarding.html        # Onboarding page
│   ├── onboarding.css         # Onboarding styles
│   ├── onboarding.js          # Onboarding logic
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── docs/                          # 📖 Full documentation
│   ├── 01-setup-guide.md
│   ├── 02-api-reference.md
│   ├── 03-stripe-setup.md
│   ├── 04-supabase-schema.md
│   ├── 05-admin-dashboard.md
│   ├── 06-regional-pricing.md
│   ├── 07-features.md
│   └── 08-project-structure.md
├── supabase_core_tables.sql
└── README.md
```

---

## 🚀 Setup — Extension

### 1. Load the Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 2. First Run

On first install, the onboarding page opens automatically:

1. **Welcome** — See ReplyPals in action with a before/after demo
2. **Where you write** — Select your most-used apps (Gmail, LinkedIn, WhatsApp, etc.). ReplyPals sets default tones for each
3. **Your goal** — Choose what you want to improve (professional emails, fix non-native patterns, etc.)

After onboarding, the extension is ready. Click the ReplyPals icon → side panel opens.

---

## 🔧 Setup — Backend API

### 1. Prerequisites

- Python 3.9+
- A Gemini API key (or OpenAI/Anthropic key)

### 2. Install Dependencies

```bash
cd api
pip install -r requirements.txt
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your keys
```

**Required:**
| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | `gemini`, `openai`, or `anthropic` |
| `GEMINI_API_KEY` | Your Google AI API key |

**Optional (for full features):**
| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe secret key for payments |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_T1_STARTER` – `T6_TEAM` | 18 regional Stripe price IDs (see [Stripe Setup](docs/03-stripe-setup.md)) |
| `ADMIN_USERNAME` | Admin dashboard login |
| `ADMIN_PASSWORD` | Admin dashboard password |
| `ADMIN_SECRET_KEY` | 64-char JWT signing key |
| `GMAIL_ADDRESS` | Gmail for sending license keys |
| `GMAIL_APP_PASSWORD` | Gmail app password |
| `MIXPANEL_TOKEN` | Mixpanel project token |
| `CRON_SECRET` | Secret for the `/send-weekly-reports` endpoint |

### 4. Run the Server

```bash
cd api
python main.py
```

The API starts at `http://localhost:8150`. Verify:

```bash
curl http://localhost:8150/health
```

---

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/rewrite` | Rewrite text in a given tone |
| `POST` | `/generate` | Generate text from a prompt |
| `POST` | `/create-checkout` | Create Stripe checkout session |
| `POST` | `/stripe-webhook` | Handle Stripe events |
| `POST` | `/verify-license` | Verify a license key |
| `POST` | `/check-usage` | Get usage stats for a license |
| `POST` | `/save-email` | Save free user email for reports |
| `POST` | `/register-referral` | Register a referral for bonus rewrites |
| `POST` | `/create-team` | Create a team with admin key |
| `POST` | `/add-team-member` | Add member to team |
| `GET` | `/team-stats` | Get team stats (admin only) |
| `POST` | `/send-weekly-reports` | Trigger weekly email reports (cron) |

---

## 🗄 Supabase Schema

### `licenses` table
```sql
CREATE TABLE licenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'pro',
  region TEXT DEFAULT 'global',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `rewrite_logs` table
```sql
CREATE TABLE rewrite_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  text_length INTEGER,
  tone TEXT,
  language TEXT,
  score INTEGER,
  has_license BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `free_users` table
```sql
CREATE TABLE free_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  goal TEXT,
  sites JSONB DEFAULT '[]',
  ref_code TEXT UNIQUE,
  bonus_rewrites INTEGER DEFAULT 0,
  total_rewrites INTEGER DEFAULT 0,
  avg_score NUMERIC DEFAULT 0,
  tips_log JSONB DEFAULT '[]',
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `teams` table
```sql
CREATE TABLE teams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  seat_count INTEGER DEFAULT 5,
  brand_voice TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `team_members` table
```sql
CREATE TABLE team_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  member_key TEXT UNIQUE NOT NULL,
  rewrites INTEGER DEFAULT 0,
  avg_score NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 💰 Pricing

| Plan | Price | Rewrites | Features |
|------|-------|----------|----------|
| **Free** | $0 | 5 total | All tones, all languages |
| **Starter** | $2/mo | 50/month | Everything in Free |
| **Pro** | $9/mo | Unlimited | Templates, tone memory, weekly reports |
| **Team** | $25/mo | Unlimited (5 seats) | Admin dashboard, brand voice, team stats |

---

## 🔐 Privacy

- **No text is logged.** The API processes text in memory and discards it immediately.
- **No text is sent to analytics.** Only metadata (tone selected, score, feature used) is tracked.
- **User text is never visible** in server logs, database, or analytics dashboards.
- The privacy bar in the side panel and the tooltip on the inline icon both confirm this to users.

---

## 📬 Email System

ReplyPals uses Gmail SMTP to send:

1. **License key delivery** — After Stripe checkout completes
2. **Welcome email** — When a free user saves their email
3. **Weekly reports** — Triggered via the `/send-weekly-reports` cron endpoint
4. **Team invitations** — When an admin invites a member

Set `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` in your `.env` to enable.

> **Gmail App Password:** Go to [Google Account → Security → 2-Step Verification → App Passwords](https://myaccount.google.com/apppasswords) to generate one.

---

## 📊 Analytics (Mixpanel)

Events tracked (no personal data):
- `extension_installed` — First install
- `popup_opened` — Side panel opened (site hostname only)
- `rewrite_completed` — With tone and score
- `template_used` — With template ID
- `upgrade_clicked` — With selected plan
- `referral_shared` — With channel (copy/whatsapp)
- `tone_selected` — With tone name

Set `MIXPANEL_TOKEN` in both `.env` (backend) and `analytics.js` / `background.js` (extension).

---

## 📖 Documentation

Full documentation is available in the [`docs/`](docs/) folder:

| Document | Description |
|----------|-------------|
| [Setup Guide](docs/01-setup-guide.md) | Getting started from scratch |
| [API Reference](docs/02-api-reference.md) | All endpoints with examples |
| [Stripe Setup](docs/03-stripe-setup.md) | Regional pricing + Stripe config |
| [Supabase Schema](docs/04-supabase-schema.md) | All 9 database tables |
| [Admin Dashboard](docs/05-admin-dashboard.md) | Admin panel features |
| [Regional Pricing](docs/06-regional-pricing.md) | 6-tier pricing system |
| [Features](docs/07-features.md) | Complete feature reference |
| [Project Structure](docs/08-project-structure.md) | Directory layout + dependencies |

---

## 🔮 Coming Soon

- Auto-improve while typing (Pro feature)
- Browser-native spell-check integration
- Chrome Web Store publication
- Mobile companion app

---

## 📄 License

This project is proprietary. All rights reserved.

---

## 🚄 Deploy on Railway

1. Push this repo to GitHub.
2. In Railway, create a new project from the repo.
3. Railway will use `railway.json` at repo root.
4. Set required env vars from `api/.env.example` (do not commit real secrets).
5. Add custom domains:
   - `api.replypals.in` for API
   - `replypals.in` for website (optional same service or separate service)
6. Set DNS records in your domain provider using Railway-provided targets.

### Runtime command used

`cd api && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8150}`

### Recommended production env

- `APP_ENV=production`
- `UVICORN_RELOAD=0`
- `UVICORN_WORKERS=2`
- `FRONTEND_SUCCESS_URL=https://replypals.in/success`
- `FRONTEND_CANCEL_URL=https://replypals.in/dashboard`
- `ALLOWED_ORIGINS=https://replypals.in,https://www.replypals.in,chrome-extension://<YOUR_EXTENSION_ID>`

