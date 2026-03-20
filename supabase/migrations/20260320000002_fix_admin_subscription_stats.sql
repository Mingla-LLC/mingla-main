-- Fix admin_subscription_stats: 'status' column does not exist on admin_subscription_overrides.
-- Active overrides are determined by: revoked_at IS NULL AND starts_at <= now() AND expires_at > now()

CREATE OR REPLACE FUNCTION admin_subscription_stats()
RETURNS JSONB AS $$
DECLARE result JSONB;
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM profiles),
    'free', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'free'),
    'pro', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'pro'),
    'elite', (SELECT count(*) FROM profiles p WHERE get_effective_tier(p.id) = 'elite'),
    'overrides', (SELECT count(*) FROM admin_subscription_overrides
      WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()),
    'expiring_soon', (SELECT count(*) FROM admin_subscription_overrides
      WHERE revoked_at IS NULL AND starts_at <= now() AND expires_at > now()
      AND expires_at <= now() + interval '7 days')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
