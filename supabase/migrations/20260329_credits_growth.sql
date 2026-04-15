-- ReplyPals — Growth plan, credits balance, usage split, credit purchases
-- Run after 20260328_billing_usage.sql. Safe to re-run (IF NOT EXISTS).

-- ─── user_profiles ───────────────────────────────────────────────────────────
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cost_flagged BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN user_profiles.credit_balance IS 'Non-expiring rewrite credits (consumed after subscription caps)';
COMMENT ON COLUMN user_profiles.cost_flagged IS 'Set when daily LLM cost guardrail trips';

-- Plan values (incl. growth) are enforced in the API; avoid DB CHECK to not break legacy rows.

-- ─── usage_logs: subscription vs credit attribution ─────────────────────────
ALTER TABLE usage_logs
    ADD COLUMN IF NOT EXISTS subscription_rewrites INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credit_rewrites INTEGER NOT NULL DEFAULT 0;

-- Backfill: treat historical counts as subscription usage
UPDATE usage_logs
SET subscription_rewrites = GREATEST(0, COALESCE(rewrite_count, 0))
WHERE subscription_rewrites = 0 AND COALESCE(rewrite_count, 0) > 0;

-- ─── credit_transactions (Stripe one-time credit purchases) ───────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    stripe_payment_intent_id TEXT,
    stripe_checkout_session_id TEXT,
    bundle_key TEXT NOT NULL,
    credits_added INTEGER NOT NULL,
    amount_paid_usd NUMERIC(10, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_pi ON credit_transactions (stripe_payment_intent_id);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE credit_transactions IS 'Audit log for purchased credit bundles';

-- Refresh app_settings plan_limits seed to include growth (do not overwrite custom admin JSON)
INSERT INTO app_settings (key, value)
VALUES (
    'plan_limits',
    '{"free":{"monthly":10,"daily":null},"starter":{"monthly":25,"daily":null},"pro":{"monthly":300,"daily":20},"growth":{"monthly":750,"daily":50},"team":{"monthly":150,"daily":15},"enterprise":{"monthly":null,"daily":null}}'
)
ON CONFLICT (key) DO NOTHING;
