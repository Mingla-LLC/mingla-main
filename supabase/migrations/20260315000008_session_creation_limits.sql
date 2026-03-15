-- ============================================================
-- Function to check session creation eligibility
-- ============================================================
CREATE OR REPLACE FUNCTION check_session_creation_allowed(p_user_id UUID)
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
  v_max := (v_limits->>'max_sessions')::INTEGER;

  -- Count active sessions created by this user
  SELECT COUNT(*) INTO v_count
  FROM collaboration_sessions
  WHERE created_by = p_user_id
    AND status IN ('pending', 'active')
    AND (archived_at IS NULL);

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

-- ============================================================
-- Function to check pairing eligibility
-- ============================================================
CREATE OR REPLACE FUNCTION check_pairing_allowed(p_user_id UUID)
RETURNS TABLE(allowed BOOLEAN, tier TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier TEXT;
BEGIN
  v_tier := get_effective_tier(p_user_id);

  -- Only Elite users can pair
  allowed := (v_tier = 'elite');
  tier := v_tier;
  RETURN NEXT;
END;
$$;

-- ============================================================
-- Function to get max_participants based on creator's tier
-- ============================================================
CREATE OR REPLACE FUNCTION get_session_member_limit(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier TEXT;
  v_limits JSONB;
BEGIN
  v_tier := get_effective_tier(p_user_id);
  v_limits := get_tier_limits(v_tier);
  RETURN (v_limits->>'max_session_members')::INTEGER;
END;
$$;
