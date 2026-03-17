-- =============================================================
-- Admin Subscription Overrides
-- =============================================================

-- Table: admin_subscription_overrides
-- Stores tier overrides granted by admins. When active, these
-- take absolute precedence over RevenueCat, trials, and referrals.
CREATE TABLE IF NOT EXISTS admin_subscription_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL CHECK (tier IN ('free', 'pro', 'elite')),
  reason      TEXT NOT NULL,               -- why the override was granted (for audit)
  granted_by  UUID NOT NULL REFERENCES auth.users(id), -- admin user who granted it
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,        -- when the override ends
  revoked_at  TIMESTAMPTZ,                 -- non-null = manually revoked early
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup during tier resolution
CREATE INDEX idx_admin_overrides_user_active
  ON admin_subscription_overrides (user_id, expires_at)
  WHERE revoked_at IS NULL;

-- Index for admin browsing
CREATE INDEX idx_admin_overrides_granted_by
  ON admin_subscription_overrides (granted_by);

-- Auto-update updated_at
CREATE TRIGGER set_admin_overrides_updated_at
  BEFORE UPDATE ON admin_subscription_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================
-- RLS Policies
-- =============================================================
ALTER TABLE admin_subscription_overrides ENABLE ROW LEVEL SECURITY;

-- Regular users can read their own overrides (so mobile can display "gifted by admin" badge)
CREATE POLICY "Users can read own overrides"
  ON admin_subscription_overrides FOR SELECT
  USING (auth.uid() = user_id);

-- =============================================================
-- Helper: Check if the calling user is an active admin
-- Used by all admin_* RPC functions to prevent unauthorized access.
-- Looks up auth.uid()'s email in the admin_users table.
-- =============================================================
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_email TEXT;
BEGIN
  -- Get the calling user's email from auth.users
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = auth.uid();

  IF v_email IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check if this email is an active admin
  RETURN EXISTS (
    SELECT 1 FROM admin_users
    WHERE email = v_email
      AND status = 'active'
  );
END;
$$;

-- =============================================================
-- Update get_effective_tier() to check admin overrides FIRST
-- NOTE: No admin check here — this is called for ALL users
-- (mobile app calls it to resolve tier). Read-only, safe.
-- =============================================================
CREATE OR REPLACE FUNCTION get_effective_tier(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_sub RECORD;
  v_override_tier TEXT;
  v_has_completed_onboarding BOOLEAN;
BEGIN
  -- Priority 0: Active admin override (highest priority)
  SELECT tier INTO v_override_tier
  FROM admin_subscription_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  ORDER BY
    CASE tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  IF v_override_tier IS NOT NULL THEN
    RETURN v_override_tier;
  END IF;

  -- Priority 1+: existing logic (unchanged)
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF v_sub.tier IN ('pro', 'elite')
     AND v_sub.is_active = true
     AND v_sub.current_period_end > now() THEN
    RETURN v_sub.tier;
  END IF;

  -- Trial (during onboarding: trial_ends_at is NULL, user is not onboarded = elite)
  SELECT has_completed_onboarding INTO v_has_completed_onboarding
  FROM profiles
  WHERE id = p_user_id;

  IF v_sub.trial_ends_at IS NULL AND v_has_completed_onboarding IS NOT TRUE THEN
    RETURN 'elite';  -- onboarding trial
  END IF;

  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    RETURN 'elite';  -- active post-onboarding trial
  END IF;

  -- Referral bonus
  IF v_sub.referral_bonus_months > v_sub.referral_bonus_used_months THEN
    RETURN 'pro';
  END IF;

  RETURN 'free';
END;
$$;

-- =============================================================
-- Admin RPC: List all users with subscription status
-- ADMIN AUTH: Requires caller to be in admin_users with active status
-- =============================================================
CREATE OR REPLACE FUNCTION admin_list_subscriptions(
  p_search TEXT DEFAULT NULL,        -- search by name, phone, or email
  p_tier_filter TEXT DEFAULT NULL,   -- filter by effective tier
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  user_id         UUID,
  display_name    TEXT,
  phone           TEXT,
  effective_tier  TEXT,
  raw_tier        TEXT,
  is_active       BOOLEAN,
  trial_ends_at   TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  referral_bonus_months INTEGER,
  referral_bonus_used_months INTEGER,
  has_admin_override BOOLEAN,
  admin_override_tier TEXT,
  admin_override_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Admin authorization check
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.first_name || ' ' || COALESCE(p.last_name, '') AS display_name,
    p.phone AS phone,
    get_effective_tier(p.id) AS effective_tier,
    COALESCE(s.tier, 'free') AS raw_tier,
    COALESCE(s.is_active, false) AS is_active,
    s.trial_ends_at,
    s.current_period_end,
    COALESCE(s.referral_bonus_months, 0) AS referral_bonus_months,
    COALESCE(s.referral_bonus_used_months, 0) AS referral_bonus_used_months,
    (ao.id IS NOT NULL) AS has_admin_override,
    ao.tier AS admin_override_tier,
    ao.expires_at AS admin_override_expires_at,
    p.created_at
  FROM profiles p
  LEFT JOIN subscriptions s ON s.user_id = p.id
  LEFT JOIN LATERAL (
    SELECT o.id, o.tier, o.expires_at
    FROM admin_subscription_overrides o
    WHERE o.user_id = p.id
      AND o.revoked_at IS NULL
      AND o.starts_at <= now()
      AND o.expires_at > now()
    ORDER BY CASE o.tier WHEN 'elite' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC
    LIMIT 1
  ) ao ON true
  WHERE
    (p_search IS NULL OR (
      p.first_name ILIKE '%' || p_search || '%'
      OR p.last_name ILIKE '%' || p_search || '%'
      OR p.phone ILIKE '%' || p_search || '%'
    ))
    AND (p_tier_filter IS NULL OR get_effective_tier(p.id) = p_tier_filter)
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- =============================================================
-- Admin RPC: Grant a tier override
-- ADMIN AUTH: Requires caller to be in admin_users with active status
-- =============================================================
CREATE OR REPLACE FUNCTION admin_grant_override(
  p_user_id    UUID,
  p_tier       TEXT,
  p_reason     TEXT,
  p_granted_by UUID,
  p_starts_at  TIMESTAMPTZ DEFAULT now(),
  p_expires_at TIMESTAMPTZ DEFAULT NULL,   -- NULL = 30 days from now
  p_duration_days INTEGER DEFAULT 30       -- used if p_expires_at is NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_override_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  -- Admin authorization check
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Validate tier
  IF p_tier NOT IN ('free', 'pro', 'elite') THEN
    RAISE EXCEPTION 'Invalid tier: %. Must be free, pro, or elite.', p_tier;
  END IF;

  -- Validate user exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist.', p_user_id;
  END IF;

  -- Calculate expiry
  v_expires := COALESCE(p_expires_at, p_starts_at + (p_duration_days || ' days')::INTERVAL);

  -- Validate dates
  IF v_expires <= p_starts_at THEN
    RAISE EXCEPTION 'expires_at must be after starts_at';
  END IF;

  -- Revoke any existing active overrides for this user (only one active at a time)
  UPDATE admin_subscription_overrides
  SET revoked_at = now(), updated_at = now()
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND expires_at > now();

  -- Insert new override
  INSERT INTO admin_subscription_overrides (user_id, tier, reason, granted_by, starts_at, expires_at)
  VALUES (p_user_id, p_tier, p_reason, p_granted_by, p_starts_at, v_expires)
  RETURNING id INTO v_override_id;

  RETURN v_override_id;
END;
$$;

-- =============================================================
-- Admin RPC: Revoke an override early
-- ADMIN AUTH: Requires caller to be in admin_users with active status
-- =============================================================
CREATE OR REPLACE FUNCTION admin_revoke_override(
  p_override_id UUID,
  p_revoked_by  UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Admin authorization check
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE admin_subscription_overrides
  SET revoked_at = now(), updated_at = now()
  WHERE id = p_override_id
    AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$;

-- =============================================================
-- Admin RPC: View override history for a user
-- ADMIN AUTH: Requires caller to be in admin_users with active status
-- =============================================================
CREATE OR REPLACE FUNCTION admin_get_override_history(
  p_user_id UUID
)
RETURNS TABLE (
  id          UUID,
  tier        TEXT,
  reason      TEXT,
  granted_by  UUID,
  starts_at   TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  is_active   BOOLEAN,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  -- Admin authorization check
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.tier,
    o.reason,
    o.granted_by,
    o.starts_at,
    o.expires_at,
    o.revoked_at,
    (o.revoked_at IS NULL AND o.starts_at <= now() AND o.expires_at > now()) AS is_active,
    o.created_at
  FROM admin_subscription_overrides o
  WHERE o.user_id = p_user_id
  ORDER BY o.created_at DESC;
END;
$$;
