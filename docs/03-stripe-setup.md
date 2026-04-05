# 💳 Stripe Setup Guide — Regional Pricing

ReplyPals uses **6 pricing tiers** with auto-detection based on the user's country.
Each tier has 3 plans (Starter, Pro, Team) = **18 Stripe prices** total.

---

## Pricing Tiers

| Tier | Countries | Starter | Pro | Team | Currency |
|------|-----------|---------|-----|------|----------|
| **Tier 1** | US, GB, AU, CA, NZ, DE, FR, NL, SE, NO, DK, FI, CH, IE | $2 | $9 | $25 | USD |
| **Tier 2** | AE, SA, QA, KW, BH, OM, PL, CZ, HU, RO, TR | $1.5 | $6 | $20 | USD |
| **Tier 3** | IN | ₹149 | ₹329 | ₹1,999 | INR |
| **Tier 4** | PH, MY, ID, TH, VN, MM | ₱99 | ₱229 | ₱1,299 | PHP |
| **Tier 5** | BR, MX, CO, AR, CL, PE | R$9 | R$19 | R$99 | BRL |
| **Tier 6** | All others (fallback) | $1 | $3 | $12 | USD |

---

## Step 1: Get Your Secret Key

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Toggle **Test mode** ON (top right) for testing
3. Go to **Developers** → **API keys**
4. Copy your **Secret key** (`sk_test_...` or `sk_live_...`)
5. Paste in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_YOUR_KEY
   ```

---

## Step 2: Create Products & Prices

Go to **Product catalog** → **Add product** for each. You need to create **18 prices** total.

### Tier 1 (USD — Full Price)
| Product Name | Price | `.env` Variable |
|-------------|-------|-----------------|
| ReplyPals Starter (Tier 1) | $2.00/mo | `STRIPE_PRICE_T1_STARTER` |
| ReplyPals Pro (Tier 1) | $9.00/mo | `STRIPE_PRICE_T1_PRO` |
| ReplyPals Team (Tier 1) | $25.00/mo | `STRIPE_PRICE_T1_TEAM` |

### Tier 2 (USD — Reduced)
| Product Name | Price | `.env` Variable |
|-------------|-------|-----------------|
| ReplyPals Starter (Tier 2) | $1.50/mo | `STRIPE_PRICE_T2_STARTER` |
| ReplyPals Pro (Tier 2) | $6.00/mo | `STRIPE_PRICE_T2_PRO` |
| ReplyPals Team (Tier 2) | $20.00/mo | `STRIPE_PRICE_T2_TEAM` |

### Tier 3 (INR — India)
| Product Name | Price | `.env` Variable |
|-------------|-------|-----------------|
| ReplyPals Starter (India) | ₹149/mo | `STRIPE_PRICE_T3_STARTER` |
| ReplyPals Pro (India) | ₹329/mo | `STRIPE_PRICE_T3_PRO` |
| ReplyPals Team (India) | ₹1,999/mo | `STRIPE_PRICE_T3_TEAM` |

### Tier 4 (PHP — Southeast Asia)
| Product Name | Price | `.env` Variable |
|-------------|-------|-----------------|
| ReplyPals Starter (SEA) | ₱99/mo | `STRIPE_PRICE_T4_STARTER` |
| ReplyPals Pro (SEA) | ₱229/mo | `STRIPE_PRICE_T4_PRO` |
| ReplyPals Team (SEA) | ₱1,299/mo | `STRIPE_PRICE_T4_TEAM` |

### Tier 5 (BRL — Latin America)
| Product Name | Price | `.env` Variable |
|-------------|-------|-----------------|
| ReplyPals Starter (LATAM) | R$9/mo | `STRIPE_PRICE_T5_STARTER` |
| ReplyPals Pro (LATAM) | R$19/mo | `STRIPE_PRICE_T5_PRO` |
| ReplyPals Team (LATAM) | R$99/mo | `STRIPE_PRICE_T5_TEAM` |

### Tier 6 (USD — Low / Rest of World)
| Product Name | Price | `.env` Variable |
|-------------|-------|-----------------|
| ReplyPals Starter (ROW) | $1.00/mo | `STRIPE_PRICE_T6_STARTER` |
| ReplyPals Pro (ROW) | $3.00/mo | `STRIPE_PRICE_T6_PRO` |
| ReplyPals Team (ROW) | $12.00/mo | `STRIPE_PRICE_T6_TEAM` |

**For each product:**
1. Click **Add product** in Stripe Dashboard
2. Set the name, description, and price
3. After saving, copy the `price_...` API ID from the Pricing section
4. Paste it into the corresponding `.env` variable

---

## Step 3: Setup Webhook

1. Go to **Developers** → **Webhooks**
2. Click **Add an endpoint**
3. **Endpoint URL**: `https://your-api.railway.app/stripe-webhook`
   - For local testing: use [ngrok](https://ngrok.com) → `https://your-ngrok-url.ngrok.app/stripe-webhook`
4. **Events**: Select `checkout.session.completed`
5. Click **Add endpoint**
6. Copy the **Signing secret** (`whsec_...`)
7. Paste in `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET
   ```

---

## Step 4: Restart & Verify

1. Restart your API server (`Ctrl+C` then `python main.py`)
2. Go to Admin Dashboard → Settings
3. Stripe section should show ● **Live Mode** or ● **Test Mode**
4. Use the **Preview as country** dropdown in Regional Pricing to verify tier prices

---

## How It Works

1. User opens upgrade screen → extension calls `GET /pricing`
2. Backend detects user's country from IP using `ip-api.com`
3. Returns the correct tier with localized display prices
4. User clicks "Get Access" → extension sends `{ email, plan, tier }` to `POST /create-checkout`
5. Backend looks up `STRIPE_PRICE_MAP[tier][plan]` to get the right Stripe price ID
6. Creates Stripe checkout session with the tier-specific price

**Anti-abuse:** VPN/proxy users are silently served Tier 1 (full price) pricing.
