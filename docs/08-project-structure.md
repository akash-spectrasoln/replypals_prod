# 📁 ReplyPals — Project Structure

```
replypal extension/
│
├── api/                            # FastAPI Backend
│   ├── main.py                     # Main API — all endpoints, pricing tiers, AI providers
│   ├── admin_routes.py             # Admin panel API — 30+ endpoints
│   ├── requirements.txt            # Python dependencies
│   ├── .env                        # Environment variables (not committed)
│   ├── .env.example                # Template for env vars
│   └── admin/                      # Admin dashboard frontend
│       ├── index.html              # Single-page admin HTML (Tailwind CSS)
│       ├── admin.js                # Admin core JS (auth, routing, API calls)
│       └── admin_pages.js          # Admin page renderers (9 pages)
│
├── extension/                      # Chrome Extension
│   ├── manifest.json               # Chrome extension manifest v3
│   ├── background.js               # Service worker — API calls, onboarding, analytics
│   ├── content.js                  # Content script — inline icon, popup, rewrite UI
│   ├── popup.html                  # Side panel HTML
│   ├── popup.css                   # Side panel styles
│   ├── popup.js                    # Side panel logic
│   ├── templates.js                # Template library (25 templates, 4 categories)
│   ├── analytics.js                # Mixpanel HTTP API wrapper
│   ├── onboarding.html             # First-install onboarding page
│   ├── onboarding.css              # Onboarding styles
│   ├── onboarding.js               # Onboarding 3-step wizard logic
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
├── docs/                           # Documentation
│   ├── 01-setup-guide.md           # Getting started
│   ├── 02-api-reference.md         # API endpoint docs
│   ├── 03-stripe-setup.md          # Stripe + regional pricing setup
│   ├── 04-supabase-schema.md       # Database schema
│   ├── 05-admin-dashboard.md       # Admin panel docs
│   ├── 06-regional-pricing.md      # Regional pricing system
│   ├── 07-features.md              # Feature reference
│   └── 08-project-structure.md     # This file
│
├── supabase_core_tables.sql        # SQL to create core Supabase tables
└── README.md                       # Project overview
```

---

## Key Dependencies

### Backend (Python)
| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server |
| `pydantic` | Request validation |
| `slowapi` | Rate limiting |
| `supabase` | Database client |
| `stripe` | Payment processing |
| `google-generativeai` | Gemini AI |
| `openai` | OpenAI API |
| `anthropic` | Claude API |
| `python-dotenv` | Env var loading |
| `PyJWT` | JWT authentication |
| `httpx` | Async HTTP (IP geolocation) |

### Frontend (CDN)
| Library | Purpose |
|---------|---------|
| Tailwind CSS | Admin panel styling |
| Chart.js | Admin analytics charts |
| Google Fonts (Syne, DM Sans) | Extension typography |
