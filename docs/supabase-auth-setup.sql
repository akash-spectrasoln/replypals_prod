-- ═══════════════════════════════════════════════════
-- ReplyPals — Supabase Auth Setup SQL
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- 1. Add user_id column to licenses table
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS 
  user_id UUID REFERENCES auth.users(id);

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS 
  stripe_customer_id TEXT;

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS 
  renews_at TIMESTAMPTZ;

-- 2. Add user_id column to free_users table
ALTER TABLE free_users ADD COLUMN IF NOT EXISTS 
  user_id UUID REFERENCES auth.users(id);

-- 3. Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),
  email       TEXT NOT NULL,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  last_seen   TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own profile
CREATE POLICY "users_own_profile_select" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_own_profile_update" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "users_own_profile_insert" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can read their own licenses
CREATE POLICY "users_own_license" ON licenses
  FOR SELECT USING (auth.uid() = user_id);

-- 5. Auto-create profile on signup (trigger)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, full_name)
  VALUES (
    NEW.id, 
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_licenses_user_id ON licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_free_users_user_id ON free_users(user_id);
CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
