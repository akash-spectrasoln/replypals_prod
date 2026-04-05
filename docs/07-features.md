# ⚡ ReplyPals — Feature Reference

Complete list of all implemented features.

---

## Writing Tools

| Feature | Description |
|---------|-------------|
| **Rewrite** | Select text in any input field → choose a tone → get native-sounding rewrite |
| **Generate** | Write full emails from a short prompt |
| **Smart Reply** | Right-click any message → "Reply with ReplyPals" |
| **Template Library** | 25 pre-built templates across 4 categories |
| **Tone Memory** | Remembers preferred tone per website |
| **Multi-language** | Paste Hindi, Arabic, Filipino, Portuguese, Spanish, French → get English |
| **6 Tones** | Confident, Polite, Casual, Formal, Friendly, Assertive |

---

## Progress & Insights

| Feature | Description |
|---------|-------------|
| **Native Sound Score** | 0–100 score on every rewrite |
| **Progress Card** | Weekly avg, improvement trends, most common issues |
| **Weekly Reports** | Email reports via Gmail SMTP |
| **Diff View** | "Why did this change?" expandable section |

---

## Onboarding Flow

3-step wizard on first install:
1. **Welcome** — Before/after text animation demo
2. **Where you write** — Multi-select writing apps with tone defaults
3. **Your goal** — Single-select improvement goals

---

## Pricing & Payments

| Plan | Rewrites | Notes |
|------|----------|-------|
| **Free** | 5 total | All tones, all languages |
| **Starter** | 50/month | — |
| **Pro** | Unlimited | Templates, tone memory, weekly reports |
| **Team** | Unlimited (5 seats) | Admin dashboard, brand voice, team stats |

Regional pricing auto-detected from IP (6 tiers). See [Regional Pricing](./06-regional-pricing.md).

---

## Email Capture & Re-engagement

- Email capture card appears after 3rd rewrite
- "Maybe later" dismisses permanently
- Welcome email on signup
- Weekly progress reports via cron

---

## Referral System

- Referral card appears when score ≥ 85
- Copy referral link or share on WhatsApp
- Both users get 5 bonus free rewrites

---

## Privacy

- **Zero text logging** — No user text stored or retained
- **Privacy tooltip** — Hover over ReplyPals icon shows "🔒 Your text is never stored"
- **Privacy bar** — Persistent bar in side panel
- **Anonymous analytics** — Only metadata tracked, never text content

---

## Offline Handling

- `checkOnline()` wraps all API calls
- Graceful degradation with clear toast messages
- Last 5 rewrites cached locally
- Collapsible "Recent Rewrites" section

---

## Team Plan

- Create teams with admin license key
- Invite members (up to seat limit)
- Shared brand voice injected into rewrites
- Team-wide stats dashboard
- Per-member rewrite count and avg score

---

## Analytics (Mixpanel)

Events tracked (no personal data):
- `extension_installed`, `popup_opened`
- `rewrite_completed`, `template_used`
- `upgrade_clicked`, `referral_shared`
- `tone_selected`, `copy_clicked`
