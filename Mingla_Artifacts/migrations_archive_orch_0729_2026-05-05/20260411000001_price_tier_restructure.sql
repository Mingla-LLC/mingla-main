-- ORCH-0722 (2026-05-04): Two DROP FUNCTION IF EXISTS statements added before Steps 6 and 10 to neutralize OUT-param-shape bombs (check_pairing_allowed 2→4 cols + admin_list_subscriptions 14→13 cols). Postgres rejects CREATE OR REPLACE FUNCTION when RETURNS TABLE shape differs (SQLSTATE 42P13). Production unaffected — historical apply via dashboard SQL editor where DROP+REPL was issued manually. Forensics: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0722_SIBLING_TIME_BOMB_AUDIT.md. Sibling fix: ORCH-0721 commit 4e8f784d (CONCURRENTLY removed from 20260409200001).
-- ============================================================
-- ORCH-0372: Price Tier Restructure
-- Migrates from 3 tiers (free/pro/elite) to 2 tiers (free/mingla_plus).
-- Removes swipe tracking infrastructure.
-- Deactivates trial grants (existing trials expire naturally).
--
-- MUST be applied BEFORE deploying updated mobile/admin code.
-- ============================================================

-- ─── Step 1: Data migration ─────────────────────────────────────────────────

UPDATE subscriptions
SET tier = 'mingla_plus', updated_at = now()
WHERE tier IN ('pro', 'elite');

UPDATE admin_subscription_overrides
SET tier = 'mingla_plus', updated_at = now()
WHERE tier IN ('pro', 'elite');

-- ─── Step 2: Tighten CHECK constraints ──────────────────────────────────────

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('free', 'mingla_plus'));

ALTER TABLE admin_subscription_overrides
  DROP CONSTRAINT IF EXISTS admin_subscription_overrides_tier_check;

ALTER TABLE admin_subscription_overrides
  ADD CONSTRAINT admin_subscription_overrides_tier_check
  CHECK (tier IN ('free', 'mingla_plus'));

-- ─── Step 3: Drop swipe tracking infrastructure ────────────────────────────

DROP TRIGGER IF EXISTS set_daily_swipe_counts_updated_at ON daily_swipe_counts;
DROP TABLE IF EXISTS daily_swipe_counts;
DROP FUNCTION IF EXISTS increment_daily_swipe_count(UUID);
DROP FUNCTION IF EXISTS get_remaining_swipes(UUID);

-- ─── Step 4: Replace get_tier_limits() ──────────────────────────────────────

CREATE OR REPLACE FUNCTION get_tier_limits(p_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
BEGIN
  CASE p_tier
    WHEN 'mingla_plus' THEN
      RETURN jsonb_build_object(
        'daily_swipes', -1,
        'max_pairings', -1,
        'max_sessions', -1,
        'max_session_members', -1,
        'curated_cards_access', true,
        'custom_starting_point', true
      );
    ELSE
      -- Free (default)
      RETURN jsonb_build_object(
        'daily_swipes', -1,
        'max_pairings', 1,
        'max_sessions', 1,
        'max_session_members', -1,
        'curated_cards_access', false,
        'custom_starting_point', false
      );
  END CASE;
END;
$$;

-- ─── Step 5: Replace get_effective_tier() ───────────────────────────────────
-- Authoritative version. Supersedes all prior definitions.
-- Priority: admin override > paid sub > referral bonus > free
-- Trial branches KEPT for backward compat (existing active trials expire naturally)
-- but NO NEW trials are granted.

CREATE OR REPLACE FUNCTION get_effective_tier(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_sub RECORD;
  v_override_tier TEXT;
BEGIN
  -- Priority 0: Active admin override (highest priority)
  SELECT tier INTO v_override_tier
  FROM admin_subscription_overrides
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  ORDER BY
    CASE tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
  LIMIT 1;

  IF v_override_tier IS NOT NULL THEN
    RETURN v_override_tier;
  END IF;

  -- Priority 1+: subscription-based logic
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF v_sub.tier = 'mingla_plus'
     AND v_sub.is_active = true
     AND v_sub.current_period_end > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Backward compat: active trial (existing users only — no new trials granted)
  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    RETURN 'mingla_plus';
  END IF;

  -- Referral bonus (date-based expiry, 30 days per referral from start date)
  IF v_sub.referral_bonus_months > 0
     AND v_sub.referral_bonus_started_at IS NOT NULL
     AND v_sub.referral_bonus_started_at
         + (v_sub.referral_bonus_months * INTERVAL '30 days') > now() THEN
    RETURN 'mingla_plus';
  END IF;

  RETURN 'free';
END;
$$;

-- ─── Step 6: Replace check_pairing_allowed() ────────────────────────────────
-- Changed from binary (elite-only) to count-based (free=1, mingla_plus=unlimited)

-- ORCH-0722 (2026-05-04): DROP first because the new RETURNS TABLE shape (4 cols) differs from the prior definition (2 cols, 20260315000008:41). Postgres CREATE OR REPLACE FUNCTION rejects OUT-param row-shape changes (SQLSTATE 42P13). Production already has the new shape (applied via dashboard SQL editor).
DROP FUNCTION IF EXISTS check_pairing_allowed(UUID);

CREATE OR REPLACE FUNCTION check_pairing_allowed(p_user_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, max_allowed INTEGER, tier TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier TEXT;
  v_limits JSONB;
  v_max INTEGER;
  v_count INTEGER;
BEGIN
  v_tier := get_effective_tier(p_user_id);
  v_limits := get_tier_limits(v_tier);
  v_max := (v_limits->>'max_pairings')::INTEGER;

  -- Count active pairings for this user
  SELECT COUNT(*) INTO v_count
  FROM pairings
  WHERE user_a_id = p_user_id OR user_b_id = p_user_id;

  -- -1 means unlimited
  IF v_max = -1 THEN
    allowed := true;
  ELSE
    allowed := (v_count < v_max);
  END IF;

  current_count := v_count;
  max_allowed := v_max;
  tier := v_tier;
  RETURN NEXT;
END;
$$;

-- ─── Step 7: Simplify get_session_member_limit() ────────────────────────────
-- Now returns -1 for everyone. Kept for API compatibility.

CREATE OR REPLACE FUNCTION get_session_member_limit(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN -1;
END;
$$;

-- ─── Step 8: Replace admin_subscription_stats() ─────────────────────────────

CREATE OR REPLACE FUNCTION admin_subscription_stats()
RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM profiles),
    'free', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'free'),
    'mingla_plus', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'mingla_plus'),
    'overrides', (SELECT count(*) FROM admin_subscription_overrides
      WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()),
    'expiring_soon', (SELECT count(*) FROM admin_subscription_overrides
      WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()
      AND expires_at <= now() + interval '7 days')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Step 9: Replace admin_grant_override() ─────────────────────────────────

CREATE OR REPLACE FUNCTION admin_grant_override(
  p_user_id    UUID,
  p_tier       TEXT,
  p_reason     TEXT,
  p_granted_by UUID,
  p_starts_at  TIMESTAMPTZ DEFAULT now(),
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_duration_days INTEGER DEFAULT 30
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_override_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Validate tier (2-tier model)
  IF p_tier NOT IN ('free', 'mingla_plus') THEN
    RAISE EXCEPTION 'Invalid tier: %. Must be free or mingla_plus.', p_tier;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User % does not exist.', p_user_id;
  END IF;

  v_expires := COALESCE(p_expires_at, p_starts_at + (p_duration_days || ' days')::INTERVAL);

  IF v_expires <= p_starts_at THEN
    RAISE EXCEPTION 'expires_at must be after starts_at';
  END IF;

  -- Revoke any existing active overrides for this user
  UPDATE admin_subscription_overrides
  SET revoked_at = now(), updated_at = now()
  WHERE user_id = p_user_id
    AND revoked_at IS NULL
    AND expires_at > now();

  INSERT INTO admin_subscription_overrides (user_id, tier, reason, granted_by, starts_at, expires_at)
  VALUES (p_user_id, p_tier, p_reason, p_granted_by, p_starts_at, v_expires)
  RETURNING id INTO v_override_id;

  RETURN v_override_id;
END;
$$;

-- ─── Step 10: Replace admin_list_subscriptions() ────────────────────────────

-- ORCH-0722 (2026-05-04): DROP first because the new RETURNS TABLE shape (13 cols) differs from the prior definition (14 cols, 20260317100001:153 — referral_bonus_used_months column removed in this migration). Postgres CREATE OR REPLACE FUNCTION rejects OUT-param row-shape changes (SQLSTATE 42P13). Production already has the new shape (applied via dashboard SQL editor).
DROP FUNCTION IF EXISTS admin_list_subscriptions(TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION admin_list_subscriptions(
  p_search TEXT DEFAULT NULL,
  p_tier_filter TEXT DEFAULT NULL,
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
    ORDER BY CASE o.tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
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

-- ─── Step 11: Deactivate trial grants ───────────────────────────────────────
-- create_subscription_on_onboarding_complete no longer sets trial_ends_at.
-- Existing trials expire naturally via get_effective_tier() backward compat.

CREATE OR REPLACE FUNCTION public.create_subscription_on_onboarding_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- No-op: trials are no longer granted.
  -- The subscription row is created at signup via create_subscription_on_signup().
  -- Existing users with active trials retain them (get_effective_tier checks trial_ends_at).
  -- The trial abuse phone-hash system stays dormant as a safety net.
  RETURN NEW;
END;
$$;

-- ─── Step 12: Drop deprecated referral_bonus_used_months column ─────────────
-- Deprecated in migration 20260331000002 (replaced by date-based expiry via
-- referral_bonus_started_at). No code reads this column. Safe to drop.

ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS referral_bonus_used_months;
