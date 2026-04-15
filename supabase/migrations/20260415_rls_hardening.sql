-- ReplyPals: RLS hardening pass
-- Goal: make security posture explicit for sensitive backend-managed tables.
-- Safe to run multiple times.

-- Ensure RLS is enabled on all backend-managed tables.
ALTER TABLE IF EXISTS free_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS team_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS llm_call_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rewrite_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS app_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usage_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS anon_usage      ENABLE ROW LEVEL SECURITY;

-- Service-role full access policy helper.
DO $$
DECLARE
  t TEXT;
  policy_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'free_users',
    'teams',
    'team_members',
    'llm_call_logs',
    'rewrite_logs',
    'email_log',
    'app_settings',
    'admin_audit_log',
    'api_logs',
    'usage_logs',
    'anon_usage'
  ]
  LOOP
    policy_name := 'service_role_full_access_' || t;
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      policy_name,
      t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I
         FOR ALL
         TO service_role
         USING (true)
         WITH CHECK (true)',
      policy_name,
      t
    );
  END LOOP;
END $$;

COMMENT ON TABLE anon_usage IS
  'Anonymous extension usage counters (lifetime cap). RLS enabled; backend service role access only.';
