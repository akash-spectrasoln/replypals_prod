-- ═══════════════════════════════════════════════════════════════
-- ReplyPals — Supabase SQL Migration: llm_call_logs redesign
-- Run ONCE in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Drop legacy tables (already migrated, keep history if you want) ───
-- DROP TABLE IF EXISTS api_logs;       -- replaced by llm_call_logs
-- DROP TABLE IF EXISTS api_call_logs;  -- replaced by llm_call_logs
-- DROP TABLE IF EXISTS rewrite_logs;   -- old name

-- ─── 2. Create llm_call_logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_call_logs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHO called
  -- user_id links to auth.users — used for fast COUNT (rate limiting)
  user_id           UUID          REFERENCES auth.users(id),
  email             TEXT,
  license_key       TEXT,
  plan              TEXT          NOT NULL DEFAULT 'free',
  has_license       BOOLEAN       NOT NULL DEFAULT false,

  -- WHAT they did
  action            TEXT          NOT NULL DEFAULT 'rewrite',
  -- rewrite | summarize | reply | fix | explain | translate | write

  source            TEXT          NOT NULL DEFAULT 'extension',
  -- popup | content_selection | content_input | voice

  -- WHICH AI provider was used
  ai_provider       TEXT          NOT NULL DEFAULT 'gemini',
  -- gemini | openai | anthropic

  ai_model          TEXT          NOT NULL DEFAULT 'gemini-1.5-flash',
  -- e.g. gemini-1.5-flash, gpt-4o-mini, claude-3-5-haiku-20241022

  -- INPUT details
  text_length       INTEGER       DEFAULT 0,
  tone              TEXT,
  language          TEXT,

  -- OUTPUT details
  score             INTEGER       DEFAULT 0,
  prompt_tokens     INTEGER       DEFAULT 0,
  completion_tokens INTEGER       DEFAULT 0,
  total_tokens      INTEGER       DEFAULT 0,

  -- COST (calculated in Python at insert time)
  cost_usd          NUMERIC(10,6) DEFAULT 0,

  -- RESULT
  status            TEXT          NOT NULL DEFAULT 'success',
  -- success | error | timeout | rate_limited

  error_message     TEXT,
  latency_ms        INTEGER       DEFAULT 0,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 3. Indexes (make COUNT queries fast for rate limiting) ──────────────
-- PRIMARY: count by user_id  (O(1) UUID exact match — fastest path)
CREATE INDEX IF NOT EXISTS idx_llm_user_id
  ON llm_call_logs(user_id, created_at DESC)
  WHERE status = 'success' AND user_id IS NOT NULL;

-- FALLBACK: count by email for anonymous / non-authed users
CREATE INDEX IF NOT EXISTS idx_llm_email_time
  ON llm_call_logs(email, created_at DESC)
  WHERE status = 'success';

-- Rate limiting: count by license_key + window (paid users)
CREATE INDEX IF NOT EXISTS idx_llm_license_time
  ON llm_call_logs(license_key, created_at DESC)
  WHERE status = 'success' AND license_key IS NOT NULL;

-- Admin panel breakdowns
CREATE INDEX IF NOT EXISTS idx_llm_provider
  ON llm_call_logs(ai_provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_action
  ON llm_call_logs(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_created
  ON llm_call_logs(created_at DESC);

-- Safety: if table already existed without user_id, add it now
ALTER TABLE llm_call_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- ─── 4. Row Level Security (backend only, never from extension) ──────────
ALTER TABLE llm_call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only" ON llm_call_logs;
CREATE POLICY "service_role_only" ON llm_call_logs
  AS PERMISSIVE FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 5. licenses — keep LIMIT columns, drop stale counter ───────────────
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS rewrites_limit INTEGER     DEFAULT -1,
  ADD COLUMN IF NOT EXISTS reset_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_id        UUID        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS active         BOOLEAN     DEFAULT true;

-- Drop the old counter — COUNT(llm_call_logs) replaces it
ALTER TABLE licenses DROP COLUMN IF EXISTS rewrites_used;

-- ─── 6. free_users — bonus grants only ──────────────────────────────────
ALTER TABLE free_users
  ADD COLUMN IF NOT EXISTS user_id         UUID        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS bonus_rewrites  INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_active     TIMESTAMPTZ;

-- Drop stale counter columns
ALTER TABLE free_users DROP COLUMN IF EXISTS rewrites_used;
ALTER TABLE free_users DROP COLUMN IF EXISTS total_rewrites;
ALTER TABLE free_users DROP COLUMN IF EXISTS avg_score;

-- ─── 7. user_profiles — stats cache only ────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS scores_log JSONB   DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS top_tone   TEXT,
  ADD COLUMN IF NOT EXISTS last_seen  TIMESTAMPTZ;

-- ─── 8. Set default rewrites_limit per plan ─────────────────────────────
UPDATE licenses SET rewrites_limit = 100  WHERE plan = 'starter' AND (rewrites_limit IS NULL OR rewrites_limit = 0);
UPDATE licenses SET rewrites_limit = -1   WHERE plan = 'pro'     AND  rewrites_limit IS NULL;
UPDATE licenses SET rewrites_limit = 500  WHERE plan = 'team'    AND (rewrites_limit IS NULL OR rewrites_limit = 0);

-- ─── 9. Set reset_date for limited plans ────────────────────────────────
UPDATE licenses
  SET reset_date = NOW()
  WHERE reset_date IS NULL AND rewrites_limit > 0 AND active = true;

-- ─── 10. Backfill user_id via email matching ─────────────────────────────
UPDATE licenses l
  SET user_id = up.id
  FROM user_profiles up
  WHERE LOWER(l.email) = LOWER(up.email)
    AND l.user_id IS NULL AND up.id IS NOT NULL;

UPDATE free_users fu
  SET user_id = up.id
  FROM user_profiles up
  WHERE LOWER(fu.email) = LOWER(up.email)
    AND fu.user_id IS NULL AND up.id IS NOT NULL;

-- ─── DONE ────────────────────────────────────────────────────────────────
SELECT 'llm_call_logs redesign complete — rate limiting now uses COUNT(llm_call_logs)' AS status;