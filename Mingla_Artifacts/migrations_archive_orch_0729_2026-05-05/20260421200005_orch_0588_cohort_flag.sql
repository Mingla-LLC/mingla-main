-- ORCH-0588 Slice 1 — cohort flag for fine_dining signal serving
-- Default 0 = no users on new path. Admin slider bumps via admin_set_signal_serving_pct RPC.

INSERT INTO public.admin_config (key, value)
VALUES ('signal_serving_fine_dining_pct', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- New RPC for admin slider read (returns 0-100 integer).
-- admin gate matches admin_get_feature_flags pattern.
CREATE OR REPLACE FUNCTION public.admin_get_signal_serving_pct(p_signal_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_email text := auth.email();
  v_pct integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = v_admin_email AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT (value)::int INTO v_pct
  FROM public.admin_config
  WHERE key = 'signal_serving_' || p_signal_id || '_pct';

  RETURN COALESCE(v_pct, 0);
END;
$$;

-- New RPC for admin slider write.
CREATE OR REPLACE FUNCTION public.admin_set_signal_serving_pct(p_signal_id text, p_pct integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_email text := auth.email();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = v_admin_email AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_pct < 0 OR p_pct > 100 THEN
    RAISE EXCEPTION 'pct must be 0-100, got %', p_pct;
  END IF;

  INSERT INTO public.admin_config (key, value, updated_by, updated_at)
  VALUES ('signal_serving_' || p_signal_id || '_pct', to_jsonb(p_pct), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
    SET value = to_jsonb(p_pct),
        updated_by = auth.uid(),
        updated_at = now();

  RETURN p_pct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_signal_serving_pct(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_signal_serving_pct(text, integer) TO authenticated;

-- ROLLBACK:
-- REVOKE EXECUTE ON FUNCTION public.admin_get_signal_serving_pct(text) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.admin_set_signal_serving_pct(text, integer) FROM authenticated;
-- DROP FUNCTION IF EXISTS public.admin_set_signal_serving_pct(text, integer);
-- DROP FUNCTION IF EXISTS public.admin_get_signal_serving_pct(text);
-- DELETE FROM public.admin_config WHERE key = 'signal_serving_fine_dining_pct';
