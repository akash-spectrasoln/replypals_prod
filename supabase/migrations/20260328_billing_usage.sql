-- ReplyPals — billing, usage_logs, teams extensions (run in Supabase SQL editor)

-- ─── user_profiles: billing + guardrail (canonical "users" app row keyed by auth id) ───
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS billing_cycle_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS cost_paused_until TIMESTAMPTZ;

-- ─── teams: owner + Stripe + plan + seat_limit ───
ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'team',
    ADD COLUMN IF NOT EXISTS seat_limit INTEGER DEFAULT 5;

-- ─── team_members: link to auth users ───
ALTER TABLE team_members
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW();

-- usage_logs: one row per user per calendar day (rewrite_count + cost rollups)
CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    rewrite_count INTEGER NOT NULL DEFAULT 0,
    date DATE NOT NULL,
    month TEXT NOT NULL,
    estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT usage_logs_user_date_unique UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_month ON usage_logs (user_id, month);
CREATE INDEX IF NOT EXISTS idx_usage_logs_team ON usage_logs (team_id) WHERE team_id IS NOT NULL;

ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE usage_logs IS 'Daily rewrite aggregates for plan-aware rate limits and cost guardrails';

-- Optional seed: editable plan caps (API merges with code defaults if missing)
INSERT INTO app_settings (key, value)
VALUES (
    'plan_limits',
    '{"free":{"monthly":10,"daily":null},"starter":{"monthly":25,"daily":null},"pro":{"monthly":300,"daily":20},"team":{"monthly":150,"daily":15},"enterprise":{"monthly":null,"daily":null}}'
)
ON CONFLICT (key) DO NOTHING;
