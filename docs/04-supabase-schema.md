# 🗄️ ReplyPals — Supabase Database Schema

All tables use Row Level Security (RLS) enabled. The API connects via the **Service Role Key** which bypasses RLS.

---

## Core Tables

### `free_users`
Stores all free users who save their email for weekly reports.

```sql
CREATE TABLE free_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  ref_code TEXT,
  referred_by TEXT,
  bonus_rewrites INTEGER DEFAULT 0,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  goal TEXT,
  sites JSONB,
  tips_log JSONB DEFAULT '[]'::jsonb,
  total_rewrites INTEGER DEFAULT 0,
  avg_score NUMERIC DEFAULT 0
);
```

### `licenses`
Stores purchased license keys from Stripe checkout.

```sql
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  region TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `teams`
Stores team plans with admin info and brand voice.

```sql
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  admin_email TEXT NOT NULL,
  seat_count INTEGER DEFAULT 5,
  brand_voice TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `team_members`
Individual members within a team.

```sql
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT,
  member_key TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  rewrites INTEGER DEFAULT 0,
  avg_score NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `rewrite_logs`
Tracks rewrite metadata (no user text content).

```sql
CREATE TABLE rewrite_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tone TEXT,
  score INTEGER,
  tip TEXT,
  license_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Admin Panel Tables

### `email_log`
Tracks all outgoing emails.

```sql
CREATE TABLE email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  type TEXT,          -- 'license', 'welcome', 'weekly', 'manual'
  status TEXT DEFAULT 'sent',
  error TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `api_logs`
API request metadata (no user content).

```sql
CREATE TABLE api_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT,
  method TEXT,
  ip TEXT,
  plan TEXT,
  status_code INTEGER,
  latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `app_settings`
Key-value store for app configuration.

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `admin_audit_log`
Tracks all admin actions (append-only).

```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT,
  details JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Setup

Run the SQL file `supabase_core_tables.sql` in the Supabase SQL Editor for core tables, then run the admin tables SQL above.

All tables have RLS enabled. The API uses the `service_role` key which bypasses RLS automatically.
