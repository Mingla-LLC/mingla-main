-- =============================================================
-- Ensure update_updated_at_column() trigger function exists
-- (standard Supabase utility — may not exist on fresh environments)
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- CRIT-1: Fix admin_users RLS — restrict mutations to active admins
-- =============================================================

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Allow authenticated insert" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated update" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated delete" ON public.admin_users;

-- New: Only active admins can INSERT
CREATE POLICY "admin_insert_admin_users" ON public.admin_users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- New: Only active admins can UPDATE
CREATE POLICY "admin_update_admin_users" ON public.admin_users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- New: Invited admins can self-activate their own row (invite acceptance flow)
-- Without this, the UPDATE policy above blocks invited admins from transitioning
-- to 'active' because they aren't active yet. Scoped tightly: only their own row,
-- only when current status is 'invited', only setting status to 'active'.
CREATE POLICY "self_activate_admin_users" ON public.admin_users
  FOR UPDATE TO authenticated
  USING (
    email = auth.email()
    AND status = 'invited'
  )
  WITH CHECK (
    email = auth.email()
    AND status = 'active'
  );

-- New: Only active admins can DELETE
CREATE POLICY "admin_delete_admin_users" ON public.admin_users
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- =============================================================
-- CRIT-4: Fix place_pool RLS — add admin-restricted UPDATE policy
-- =============================================================

CREATE POLICY "admin_update_place_pool" ON public.place_pool
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email()
        AND au.status = 'active'
    )
  );

-- =============================================================
-- CRIT-5a: Create feature_flags table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key    TEXT UNIQUE NOT NULL,
  is_enabled  BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read flags (mobile may need to check flags)
CREATE POLICY "authenticated_read_feature_flags" ON public.feature_flags
  FOR SELECT TO authenticated USING (true);

-- Only admins can mutate
CREATE POLICY "admin_insert_feature_flags" ON public.feature_flags
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_update_feature_flags" ON public.feature_flags
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_delete_feature_flags" ON public.feature_flags
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE TRIGGER set_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- CRIT-5b: Create app_config table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.app_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   TEXT UNIQUE NOT NULL,
  config_value TEXT NOT NULL DEFAULT '',
  value_type   TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_app_config" ON public.app_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_insert_app_config" ON public.app_config
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_update_app_config" ON public.app_config
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE POLICY "admin_delete_app_config" ON public.app_config
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE TRIGGER set_app_config_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- CRIT-5c: Create integrations table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name    TEXT UNIQUE NOT NULL,
  display_name    TEXT NOT NULL,
  description     TEXT,
  is_enabled      BOOLEAN NOT NULL DEFAULT true,
  api_key_preview TEXT,          -- last 4 chars only, never full key
  config_data     JSONB DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- Only admins can read integrations (contains sensitive API key previews)
CREATE POLICY "admin_all_integrations" ON public.integrations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));

CREATE TRIGGER set_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- CRIT-5d: Create admin_email_log table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.admin_email_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  from_name       TEXT,
  from_email      TEXT,
  recipient_type  TEXT NOT NULL CHECK (recipient_type IN ('individual', 'bulk')),
  recipient_email TEXT,            -- for individual sends
  segment_filter  JSONB,           -- for bulk sends
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'partial', 'failed')),
  template_used   TEXT,
  sent_by         UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_email_log_created ON public.admin_email_log (created_at DESC);

ALTER TABLE public.admin_email_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write email logs
CREATE POLICY "admin_all_email_log" ON public.admin_email_log
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'));
