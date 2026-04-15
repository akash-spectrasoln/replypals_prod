-- ReplyPals: usage consistency + fast query paths.
-- Safe to run multiple times.

-- 1) Ensure anonymous usage table exists (lifetime anon cap).
CREATE TABLE IF NOT EXISTS anon_usage (
  anon_id TEXT PRIMARY KEY,
  total_used INTEGER NOT NULL DEFAULT 0 CHECK (total_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anon_usage_updated_at
  ON anon_usage (updated_at DESC);

-- 2) Fast team usage aggregation: team -> member keys.
CREATE INDEX IF NOT EXISTS idx_team_members_team_member_key
  ON team_members (team_id, member_key);

-- 3) Fast monthly usage scans used by /check-usage and /free-usage.
CREATE INDEX IF NOT EXISTS idx_llm_logs_success_license_month
  ON llm_call_logs (license_key, created_at DESC)
  WHERE status = 'success' AND license_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_logs_success_email_month
  ON llm_call_logs (email, created_at DESC)
  WHERE status = 'success' AND email IS NOT NULL;

COMMENT ON TABLE anon_usage IS
  'Anonymous extension usage counters (lifetime cap), fallback-safe for rate limit enforcement.';
