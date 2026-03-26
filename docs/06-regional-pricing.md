# 🌍 ReplyPals — Regional Pricing System

Every user sees **one clean pricing screen** auto-tailored to their country.
No two different prices are ever shown side by side.

---

## How It Works

1. User opens upgrade screen → extension calls `GET /pricing`
2. Backend detects user's IP → looks up country via `ip-api.com`
3. Maps country to one of **6 pricing tiers**
4. Returns localized display prices + tier identifier
5. Extension renders one upgrade screen with those prices
6. On checkout, sends `{ email, plan, tier }` → backend maps to correct Stripe price ID

---

## 6 Pricing Tiers

| Tier | Countries | Starter | Pro | Team | Currency |
|------|-----------|---------|-----|------|----------|
| **Tier 1** | US, GB, AU, CA, NZ, DE, FR, NL, SE, NO, DK, FI, CH, IE | $2 | $9 | $25 | USD |
| **Tier 2** | AE, SA, QA, KW, BH, OM, PL, CZ, HU, RO, TR | $1.5 | $6 | $20 | USD |
| **Tier 3** | IN | ₹149 | ₹329 | ₹1,999 | INR |
| **Tier 4** | PH, MY, ID, TH, VN, MM | ₱99 | ₱229 | ₱1,299 | PHP |
| **Tier 5** | BR, MX, CO, AR, CL, PE | R$9 | R$19 | R$99 | BRL |
| **Tier 6** | All others (fallback) | $1 | $3 | $12 | USD |

---

## VPN / Anti-Abuse

- Uses `ip-api.com`'s `proxy` and `hosting` fields
- If VPN/proxy detected → **silently serves Tier 1** pricing
- No error shown, no blocking — user just pays full price
- `vpn_detected: true` in response for analytics

---

## Caching

- **Backend**: 1-hour in-memory IP geo-cache (`_ip_geo_cache` dict)
- **Extension**: Results cached in `chrome.storage.session` per browser session
- **Timeout**: If ip-api.com takes >2s, falls back to Tier 1

---

## Regional Note

For non-Tier 1 users, a subtle grey line appears:

> *Pricing adjusted for your region 🌍*

The words "Asia", "India", "Global", or "LATAM" **never** appear in the user-facing UI.

---

## Admin Panel

In **Settings → Regional Pricing**:
- Full tier table with all prices and countries
- **"Preview as country"** dropdown to simulate any user's view
- VPN detection note

---

## Files Involved

| File | Role |
|------|------|
| `api/main.py` | `PRICING_TIERS`, `STRIPE_PRICE_MAP`, `GET /pricing`, updated `/create-checkout` |
| `api/admin_routes.py` | `GET /admin/pricing-preview` |
| `extension/background.js` | `handleFetchPricing()` with 2s timeout |
| `extension/popup.js` | `fetchPricingData()` + dynamic `renderPlanCards()` |
| `extension/content.js` | Dynamic `renderUpgrade()` |
| `extension/popup.html` | Empty plans grid, populated by JS |
