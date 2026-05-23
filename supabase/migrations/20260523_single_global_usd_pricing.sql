-- Single global USD pricing (launch mode).
-- Run in Supabase SQL Editor, or: python scripts/apply_single_global_pricing.py

-- Flag for API (also set PRICING_MODE=global in .env optional)
INSERT INTO system_config (key, value, description)
VALUES ('pricing_mode', 'global', 'global = same USD price for all countries; regional = PPP from country_pricing')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Every country pays full US list price in USD (no PPP discount, no local FX)
UPDATE country_pricing
SET
    price_multiplier = 1.000,
    currency_code = 'USD',
    currency_symbol = '$',
    exchange_rate_per_usd = NULL,
    is_active = TRUE;

-- One paid plan at checkout: Pro $9/mo (adjust base_price_usd here if needed)
UPDATE plan_config
SET is_active = FALSE
WHERE plan_key IN ('starter', 'growth', 'team', 'enterprise');

UPDATE plan_config
SET
    display_name = 'Pro',
    base_price_usd = 9.00,
    monthly_rewrites = NULL,
    is_active = TRUE,
    sort_order = 30
WHERE plan_key = 'pro';

UPDATE plan_config
SET
    display_name = 'Free',
    base_price_usd = 0.00,
    monthly_rewrites = 10,
    is_active = TRUE
WHERE plan_key = 'free';

-- Hide credit packs until you want them back
UPDATE credit_bundle_config
SET is_active = FALSE;
