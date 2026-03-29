-- ReplyPals — DB-driven plans, credit bundles, PPP country pricing, system knobs.
-- Safe to re-run (IF NOT EXISTS / DO blocks).

-- ─── user_profiles: geo + cumulative credit spend ─────────────────────────
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS detected_country TEXT,
    ADD COLUMN IF NOT EXISTS country_override TEXT,
    ADD COLUMN IF NOT EXISTS price_multiplier NUMERIC(5, 3),
    ADD COLUMN IF NOT EXISTS credit_spent_usd NUMERIC(10, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN user_profiles.credit_spent_usd IS 'Cumulative USD spent on credit purchases (upgrade nudges)';

-- ─── plan_config ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    monthly_rewrites INTEGER,
    base_price_usd NUMERIC(10, 2),
    seat_count INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    stripe_price_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_config_active_sort ON plan_config (is_active, sort_order);

-- ─── credit_bundle_config ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_bundle_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    credits INTEGER NOT NULL,
    base_price_usd NUMERIC(10, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    stripe_price_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_bundle_active_sort ON credit_bundle_config (is_active, sort_order);

-- ─── upgrade_nudge_config ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upgrade_nudge_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_plan TEXT NOT NULL UNIQUE,
    nudge_at_spend_usd NUMERIC(10, 2) NOT NULL,
    nudge_to_plan TEXT NOT NULL,
    message_template TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── system_config (key/value) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── country_pricing (PPP) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS country_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_code TEXT NOT NULL UNIQUE,
    country_name TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'USD',
    currency_symbol TEXT NOT NULL DEFAULT '$',
    price_multiplier NUMERIC(5, 3) NOT NULL DEFAULT 1.000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    stripe_coupon_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_country_pricing_active ON country_pricing (is_active);

-- ─── admin_audit_log: structured columns (keep legacy action/details/ip) ───
ALTER TABLE admin_audit_log
    ADD COLUMN IF NOT EXISTS admin_user_id UUID,
    ADD COLUMN IF NOT EXISTS table_name TEXT,
    ADD COLUMN IF NOT EXISTS record_id TEXT,
    ADD COLUMN IF NOT EXISTS old_value JSONB,
    ADD COLUMN IF NOT EXISTS new_value JSONB;

-- ─── RLS (service role bypasses; block direct anon) ─────────────────────────
ALTER TABLE plan_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_bundle_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_nudge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE country_pricing ENABLE ROW LEVEL SECURITY;

-- ─── Seeds: plans ───────────────────────────────────────────────────────────
INSERT INTO plan_config (plan_key, display_name, monthly_rewrites, base_price_usd, seat_count, is_active, sort_order, stripe_price_id)
VALUES
    ('free', 'Free', 10, 0.00, 1, TRUE, 10, NULL),
    ('starter', 'Starter', 25, 2.00, 1, TRUE, 20, NULL),
    ('pro', 'Pro', 300, 9.00, 1, TRUE, 30, NULL),
    ('growth', 'Growth', 750, 15.00, 1, TRUE, 40, NULL),
    ('team', 'Team', 150, 25.00, 5, TRUE, 50, NULL),
    ('enterprise', 'Enterprise', NULL, NULL, 1, TRUE, 60, NULL)
ON CONFLICT (plan_key) DO NOTHING;

-- ─── Seeds: credit bundles ──────────────────────────────────────────────────
INSERT INTO credit_bundle_config (bundle_key, display_name, credits, base_price_usd, is_active, sort_order, stripe_price_id)
VALUES
    ('nano', 'Nano Pack', 100, 2.50, TRUE, 10, NULL),
    ('starter_c', 'Starter Credits', 500, 10.00, TRUE, 20, NULL),
    ('pro_c', 'Pro Credits', 1500, 25.00, TRUE, 30, NULL),
    ('power_c', 'Power Pack', 5000, 60.00, TRUE, 40, NULL)
ON CONFLICT (bundle_key) DO NOTHING;

-- ─── Seeds: nudges ───────────────────────────────────────────────────────────
INSERT INTO upgrade_nudge_config (from_plan, nudge_at_spend_usd, nudge_to_plan, message_template)
VALUES
    ('free', 1.50, 'starter', 'You''ve spent {spent} on credits — {plan} at {price}/mo is better value!'),
    ('starter', 6.00, 'pro', 'You''ve spent {spent} on credits — {plan} at {price}/mo gives you more rewrites!'),
    ('pro', 14.00, 'growth', 'You''ve spent {spent} on credits — {plan} at {price}/mo is better value!'),
    ('growth', 24.00, 'team', 'You''ve spent {spent} on credits — {plan} at {price}/mo for multiple seats!')
ON CONFLICT (from_plan) DO NOTHING;

-- ─── Seeds: system_config ────────────────────────────────────────────────────
INSERT INTO system_config (key, value, description) VALUES
    ('cost_guardrail_usd_per_day', '0.50', 'Max estimated API cost per user per calendar day (USD)'),
    ('usage_warning_percent', '80', 'Subscription monthly usage % to show warning'),
    ('credits_cache_ttl_seconds', '300', 'In-memory commerce config cache TTL'),
    ('maintenance_mode', 'false', 'Global kill switch — API returns 503 when true')
ON CONFLICT (key) DO NOTHING;

-- ─── Seeds: country PPP (subset; default = not listed → multiplier 1.0 in API) ─
INSERT INTO country_pricing (country_code, country_name, currency_code, currency_symbol, price_multiplier, is_active)
VALUES
    ('US', 'United States', 'USD', '$', 1.000, TRUE),
    ('GB', 'United Kingdom', 'USD', '$', 0.850, TRUE),
    ('IN', 'India', 'USD', '$', 0.350, TRUE),
    ('BR', 'Brazil', 'USD', '$', 0.420, TRUE),
    ('NG', 'Nigeria', 'USD', '$', 0.280, TRUE),
    ('DE', 'Germany', 'USD', '$', 0.780, TRUE),
    ('MX', 'Mexico', 'USD', '$', 0.380, TRUE)
ON CONFLICT (country_code) DO NOTHING;
