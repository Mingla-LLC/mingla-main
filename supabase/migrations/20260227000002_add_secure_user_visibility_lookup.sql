-- Secure lookup for user visibility by identifier (email or username)
-- Used to avoid showing "Invite to Mingla" when an account exists but is hidden due to blocks.

CREATE OR REPLACE FUNCTION public.resolve_user_visibility_by_identifier(p_identifier TEXT)
RETURNS TABLE (
  user_exists BOOLEAN,
  can_view BOOLEAN,
  is_blocked BOOLEAN,
  profile_id UUID,
  username TEXT,
  email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id UUID;
  target_profile RECORD;
BEGIN
  caller_id := auth.uid();

  IF p_identifier IS NULL OR btrim(p_identifier) = '' THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF position('@' in p_identifier) > 0 THEN
    SELECT p.id, p.username, p.email
    INTO target_profile
    FROM public.profiles p
    WHERE lower(p.email) = lower(btrim(p_identifier))
    LIMIT 1;
  ELSE
    SELECT p.id, p.username, p.email
    INTO target_profile
    FROM public.profiles p
    WHERE lower(p.username) = lower(btrim(p_identifier))
    LIMIT 1;
  END IF;

  IF target_profile.id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, FALSE, NULL::UUID, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    TRUE AS user_exists,
    (
      target_profile.id = caller_id
      OR NOT EXISTS (
        SELECT 1
        FROM public.blocked_users bu
        WHERE bu.blocker_id = target_profile.id
          AND bu.blocked_id = caller_id
      )
    ) AS can_view,
    EXISTS (
      SELECT 1
      FROM public.blocked_users bu
      WHERE (bu.blocker_id = target_profile.id AND bu.blocked_id = caller_id)
         OR (bu.blocker_id = caller_id AND bu.blocked_id = target_profile.id)
    ) AS is_blocked,
    target_profile.id::UUID,
    target_profile.username::TEXT,
    target_profile.email::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_user_visibility_by_identifier(TEXT) TO authenticated;
