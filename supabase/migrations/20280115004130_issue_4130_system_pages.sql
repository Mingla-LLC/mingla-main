-- Issue #4130 (Wave 4b) — Place pool, Feature flags and Settings in Mingla Admin.
--
-- What this adds (every RPC is SECURITY DEFINER, search_path pinned, the admin
-- guard first, EXECUTE revoked from PUBLIC and anon):
--
--   1. admin_place_pool_funnel(country, city) — the honest place funnel, counted
--      on the server over the admin place-pool view (refreshed every 10
--      minutes): active places -> checked by Bouncer -> Explorers can see ->
--      have stored photos, with the same four counts per city. Every share is
--      of ACTIVE places. (The old page showed the visible share as "Judged %"
--      and a photo share of visible places only as "Photo coverage".)
--   2. admin_feature_flags_board() — every flag with what it does, whether it
--      is on, the issue its description names, when it last changed and, when
--      the change went through this page, who changed it and why.
--   3. admin_set_feature_flag(key, on, reason) — the one way the admin app
--      turns a flag on or off: a reason is required and every change writes
--      admin_audit_log. Asking for the state a flag already has changes nothing.
--   4. admin_restart_tour_for_everyone(confirm, reason) — owner only, the typed
--      word RESTART and a reason; restarts the welcome tour for every account
--      and writes admin_audit_log. (It used to be one browser-side update.)
--   5. admin_team_last_active() — owner only, like the team list: when each
--      teammate was last active (last sign-in or last recorded admin action).
--
-- Invariant (declared in the pg17 test): I-4130-SYSTEM-PAGES-ADMIN-ONLY | issue #4130 | The place funnel and flag board are admin-only aggregates; a flag changes only through admin_set_feature_flag with a reason and an audit row; restarting the tour for everyone is owner-only, needs the typed word RESTART and a reason, and writes an audit row.

--------------------------------------------------------------------------------
-- 1. Place pool funnel.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_place_pool_funnel(
  p_country_code text DEFAULT NULL,
  p_city_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_totals jsonb;
  v_cities jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH scoped AS (
    SELECT mv.city_id, mv.city_name, mv.country_code, mv.country_name, mv.city_status,
           mv.is_active, mv.bouncer_validated, mv.is_servable, mv.has_photos
      FROM public.admin_place_pool_mv mv
     WHERE (p_country_code IS NULL OR mv.country_code = p_country_code)
       AND (p_city_id IS NULL OR mv.city_id = p_city_id)
  )
  SELECT jsonb_build_object(
           'active',      count(*) FILTER (WHERE is_active),
           'checked',     count(*) FILTER (WHERE is_active AND bouncer_validated),
           'visible',     count(*) FILTER (WHERE is_active AND is_servable),
           'with_photos', count(*) FILTER (WHERE is_active AND has_photos)),
         COALESCE((
           SELECT jsonb_agg(c ORDER BY (c ->> 'active')::bigint DESC, c ->> 'city_name')
             FROM (
               SELECT jsonb_build_object(
                        'city_id',      s.city_id,
                        'city_name',    COALESCE(s.city_name, 'No city'),
                        'country_code', s.country_code,
                        'country_name', s.country_name,
                        'city_status',  s.city_status,
                        'active',       count(*) FILTER (WHERE s.is_active),
                        'checked',      count(*) FILTER (WHERE s.is_active AND s.bouncer_validated),
                        'visible',      count(*) FILTER (WHERE s.is_active AND s.is_servable),
                        'with_photos',  count(*) FILTER (WHERE s.is_active AND s.has_photos)) AS c
                 FROM scoped s
                GROUP BY s.city_id, s.city_name, s.country_code, s.country_name, s.city_status
             ) per_city), '[]'::jsonb)
    INTO v_totals, v_cities
    FROM scoped;

  RETURN v_totals || jsonb_build_object('cities', v_cities);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_place_pool_funnel(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_place_pool_funnel(text, uuid) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 2. Feature flag board.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_feature_flags_board()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'flag_key',        f.flag_key,
             'description',     f.description,
             'is_enabled',      f.is_enabled,
             'issue',           substring(COALESCE(f.description, '') FROM '#([0-9]+)'),
             'updated_at',      f.updated_at,
             'last_changed_by', last_change.admin_email,
             'last_reason',     last_change.reason,
             'last_logged_at',  last_change.created_at)
           ORDER BY f.flag_key)
      FROM public.feature_flags f
      LEFT JOIN LATERAL (
        SELECT a.admin_email, a.reason, a.created_at
          FROM public.admin_audit_log a
         WHERE a.target_type = 'feature_flag'
           AND a.target_id = f.flag_key
         ORDER BY a.created_at DESC
         LIMIT 1
      ) last_change ON true
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_feature_flags_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_feature_flags_board() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_feature_flag(
  p_flag_key text,
  p_enabled  boolean,
  p_reason   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before boolean;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'state_required'; END IF;

  SELECT f.is_enabled INTO v_before
    FROM public.feature_flags f
   WHERE f.flag_key = p_flag_key
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF v_before = p_enabled THEN
    RETURN jsonb_build_object('flag_key', p_flag_key, 'is_enabled', v_before, 'changed', false);
  END IF;

  UPDATE public.feature_flags
     SET is_enabled = p_enabled
   WHERE flag_key = p_flag_key;

  PERFORM public.admin_write_audit(
    CASE WHEN p_enabled THEN 'flag.turn_on' ELSE 'flag.turn_off' END,
    'feature_flag', p_flag_key, btrim(p_reason),
    jsonb_build_object('before', v_before, 'after', p_enabled));

  RETURN jsonb_build_object('flag_key', p_flag_key, 'is_enabled', p_enabled, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_feature_flag(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_flag(text, boolean, text) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. Danger zone: restart the welcome tour for everyone (owner only).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_restart_tour_for_everyone(
  p_confirm text,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN RAISE EXCEPTION 'owner_only'; END IF;
  IF p_confirm IS DISTINCT FROM 'RESTART' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.profiles
     SET coach_mark_step = 0
   WHERE coach_mark_step <> 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.admin_write_audit(
    'testing.restart_tour_for_everyone', 'profile', 'all', btrim(p_reason),
    jsonb_build_object('accounts_restarted', v_count));

  RETURN jsonb_build_object('restarted', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_restart_tour_for_everyone(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restart_tour_for_everyone(text, text) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. Team and roles: when each teammate was last active (owner only, like the
--    team list it sits beside). Last active is the later of their last sign-in
--    and their last recorded admin action.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_team_last_active()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT COALESCE(public.admin_team_role() = 'owner', false) THEN RAISE EXCEPTION 'owner_only'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('email', t.email, 'last_active_at', t.last_active_at))
      FROM (
        SELECT team.email,
               GREATEST(
                 (SELECT max(u.last_sign_in_at) FROM auth.users u WHERE lower(btrim(u.email)) = team.email),
                 (SELECT max(a.created_at) FROM public.admin_audit_log a WHERE lower(btrim(a.admin_email)) = team.email)
               ) AS last_active_at
          FROM (
            SELECT lower(btrim(au.email)) AS email FROM public.admin_users au
            UNION
            SELECT lower(btrim(m.email)) FROM public.admin_team_members m
          ) team
      ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_team_last_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_team_last_active() TO authenticated, service_role;
