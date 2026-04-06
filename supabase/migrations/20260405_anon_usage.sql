-- Lifetime anonymous trial counts (3 total per anon_id, never resets).
-- Enforced server-side; signed-in free tier uses usage_logs + calendar month separately.

CREATE TABLE IF NOT EXISTS anon_usage (
  anon_id TEXT PRIMARY KEY,
  total_used INTEGER NOT NULL DEFAULT 0 CHECK (total_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anon_usage_updated ON anon_usage (updated_at);

COMMENT ON TABLE anon_usage IS 'Anonymous extension users: total successful rewrites (cap 3), no monthly reset';
