-- ══════════════════════════════════════════════════════════════════
-- ReplyPals — Complete Production Database Schema
-- Run in Supabase SQL Editor (Settings → SQL Editor)
-- Safe to re-run: uses IF NOT EXISTS for idempotency
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. free_users ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS free_users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID,
    email           TEXT        UNIQUE,
    ref_code        TEXT        UNIQUE,
    referred_by     TEXT,
    bonus_rewrites  INTEGER     DEFAULT 0,
    total_rewrites  INTEGER     DEFAULT 0,
    avg_score       NUMERIC     DEFAULT 0,
    goal            TEXT,
    sites           JSONB       DEFAULT '[]'::jsonb,
    tips_log        JSONB       DEFAULT '[]'::jsonb,
    last_active     TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. licenses ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID,
    email               TEXT        NOT NULL,
    license_key         TEXT        UNIQUE NOT NULL,
    plan                TEXT        NOT NULL,
    region              TEXT,
    active              BOOLEAN     DEFAULT TRUE,
    stripe_customer_id  TEXT,
    rewrites_limit      INTEGER     DEFAULT -1,
    rewrites_used       INTEGER     DEFAULT 0,
    reset_date          TIMESTAMPTZ,
    renews_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. teams ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    license_key  TEXT        UNIQUE NOT NULL,
    admin_email  TEXT        NOT NULL,
    seat_count   INTEGER     DEFAULT 5,
    brand_voice  TEXT,
    active       BOOLEAN     DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. team_members ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID        REFERENCES teams(id) ON DELETE CASCADE,
    email       TEXT,
    member_key  TEXT        UNIQUE NOT NULL,
    active      BOOLEAN     DEFAULT TRUE,
    rewrites    INTEGER     DEFAULT 0,
    avg_score   NUMERIC     DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5. user_profiles ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
    id              UUID        PRIMARY KEY,
    email           TEXT,
    full_name       TEXT,
    total_rewrites  INTEGER     DEFAULT 0,
    avg_score       NUMERIC     DEFAULT 0,
    top_tone        TEXT,
    scores_log      JSONB       DEFAULT '[]'::jsonb,
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 6. llm_call_logs (rate-limit source of truth + cost tracking) ─
CREATE TABLE IF NOT EXISTS llm_call_logs (
    id                BIGSERIAL     PRIMARY KEY,
    user_id           UUID,
    email             TEXT,
    license_key       TEXT,
    plan              TEXT          DEFAULT 'free',
    has_license       BOOLEAN       DEFAULT FALSE,
    action            TEXT,
    source            TEXT,
    ai_provider       TEXT,
    ai_model          TEXT,
    text_length       INTEGER       DEFAULT 0,
    tone              TEXT,
    language          TEXT,
    score             INTEGER       DEFAULT 0,
    prompt_tokens     INTEGER       DEFAULT 0,
    completion_tokens INTEGER       DEFAULT 0,
    total_tokens      INTEGER       DEFAULT 0,
    cost_usd          NUMERIC(10,6) DEFAULT 0,
    status            TEXT          DEFAULT 'success',
    error_message     TEXT,
    latency_ms        INTEGER       DEFAULT 0,
    event_id          TEXT,
    created_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- Backfill migration for existing deployments that already had llm_call_logs.
ALTER TABLE llm_call_logs
    ADD COLUMN IF NOT EXISTS event_id TEXT;

-- ─── 7. rewrite_logs (legacy — kept for compatibility) ─────────────
CREATE TABLE IF NOT EXISTS rewrite_logs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tone         TEXT,
    score        INTEGER,
    tip          TEXT,
    license_key  TEXT,
    has_license  BOOLEAN     DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 8. email_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_log (
    id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email  TEXT        NOT NULL,
    subject   TEXT        NOT NULL,
    type      TEXT,
    status    TEXT        DEFAULT 'sent',
    error     TEXT,
    sent_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 9. app_settings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT        PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
VALUES ('active_model', 'gemini::gemini-2.0-flash')
ON CONFLICT (key) DO NOTHING;

-- ─── 10. admin_audit_log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    action     TEXT,
    details    JSONB,
    ip         TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 11. api_logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_logs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint    TEXT,
    method      TEXT,
    ip          TEXT,
    plan        TEXT,
    status_code INTEGER,
    latency_ms  INTEGER,
    error       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- CRITICAL PERFORMANCE INDEXES
-- Without these, every /rewrite hits a full scan on llm_call_logs.
-- ══════════════════════════════════════════════════════════════════

-- Rate limit: paid users (license_key path)
CREATE INDEX IF NOT EXISTS idx_llm_logs_license_key_status_date
    ON llm_call_logs (license_key, status, created_at DESC)
    WHERE license_key IS NOT NULL;

-- Rate limit: free users (user_id path — fastest)
CREATE INDEX IF NOT EXISTS idx_llm_logs_user_id_status_date
    ON llm_call_logs (user_id, status, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Rate limit: free users (email fallback)
CREATE INDEX IF NOT EXISTS idx_llm_logs_email_status_date
    ON llm_call_logs (email, status, created_at DESC)
    WHERE email IS NOT NULL;

-- Admin stats: date range scans
CREATE INDEX IF NOT EXISTS idx_llm_logs_created_at
    ON llm_call_logs (created_at DESC);

-- Admin stats: cost by provider
CREATE INDEX IF NOT EXISTS idx_llm_logs_provider_date
    ON llm_call_logs (ai_provider, created_at DESC);

-- Idempotency key for retry-safe logging (nullable).
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_logs_event_id_unique
    ON llm_call_logs (event_id)
    WHERE event_id IS NOT NULL;

-- License lookups
CREATE INDEX IF NOT EXISTS idx_licenses_license_key
    ON licenses (license_key) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_licenses_user_id
    ON licenses (user_id) WHERE active = TRUE AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_email
    ON licenses (email) WHERE active = TRUE;

-- Free user lookups
CREATE INDEX IF NOT EXISTS idx_free_users_user_id
    ON free_users (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_free_users_email
    ON free_users (email);

-- Case-insensitive email lookup helpers for API paths using lower(email).
CREATE INDEX IF NOT EXISTS idx_free_users_email_lower
    ON free_users ((lower(email)));

CREATE INDEX IF NOT EXISTS idx_licenses_email_lower
    ON licenses ((lower(email)));

-- Team lookups
CREATE INDEX IF NOT EXISTS idx_teams_license_key
    ON teams (license_key) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_team_members_member_key
    ON team_members (member_key);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id
    ON team_members (team_id);

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE free_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_call_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewrite_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_logs          ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own profile
DO $$ BEGIN
  CREATE POLICY "users_read_own_profile"
      ON user_profiles FOR SELECT USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated users can read their own license
DO $$ BEGIN
  CREATE POLICY "users_read_own_license"
      ON licenses FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
