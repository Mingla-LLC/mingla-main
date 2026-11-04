-- #3682 closeout wave 3 — Explorer controls for Friends of followers (#1782).
--
-- 1. A guest opts in (or out) of being reached as a "friend of a follower"
--    (brand_circle_preferences.extended_brand_reach_enabled, default false).
--    Writes are refused unless the controls switch for the caller's platform
--    is on, so a store build can ship the control dark.
-- 2. A guest stops one brand reaching them through its circle
--    (brand_circle_exits, both timestamps: every existing reader already treats
--    an exit as "this brand's circle may not reach me"), and can undo it.
--    From the Following menu this also unfollows, so the guest is never shown
--    "Following" while the brand cannot reach them.
-- 3. Re-following clears the exit; an automatic follow (purchase, RSVP,
--    booking) never re-adds a guest who left the circle.
-- 4. Admin brand usage counts a multi-channel campaign once a week, and its
--    email column counts account invite emails (the same numbers Host sees).
--
-- What a brand sees never changes: names and photos only (#876).
--
-- Invariant (declared in the pg17 test): I-3682-FRIENDS-REACH-OPT-IN | issue #3682 | Nobody is reached as a friend of a follower unless they switched it on from a build whose controls switch is live; leaving a brand's circle sticks until the guest follows again or allows it.

BEGIN;

-- ── Read model for Explorer ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3682_friends_reach_controls_live(p_platform text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT f.is_enabled FROM public.feature_flags f
     WHERE f.flag_key = CASE p_platform
       WHEN 'ios' THEN 'brand_circle_extended_controls_ios_v1'
       WHEN 'android' THEN 'brand_circle_extended_controls_android_v1'
       ELSE NULL END
  ), false);
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3682_explorer_friends_reach_v1(p_platform text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_pref public.brand_circle_preferences%ROWTYPE;
  v_exits jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'friends_reach_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_pref FROM public.brand_circle_preferences WHERE user_id = v_user;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'brandId', b.id,
      'brandName', b.name,
      'brandSlug', b.slug,
      'photoUrl', b.profile_photo_url,
      'exitedAt', COALESCE(x.delivery_exited_at, x.visibility_exited_at)
    ) ORDER BY COALESCE(x.delivery_exited_at, x.visibility_exited_at) DESC, b.id), '[]'::jsonb)
    INTO v_exits
    FROM public.brand_circle_exits x
    JOIN public.brands b ON b.id = x.brand_id AND b.deleted_at IS NULL
   WHERE x.user_id = v_user;
  RETURN jsonb_build_object(
    'controlsLive', public.issue_3682_friends_reach_controls_live(p_platform),
    'extendedEnabled', COALESCE(v_pref.extended_brand_reach_enabled, false),
    'decidedAt', v_pref.extended_brand_reach_decided_at,
    'exits', v_exits
  );
END;
$fn$;

-- ── Opt in / out ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3682_set_friends_reach_v1(
  p_platform text, p_enabled boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'friends_reach_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_3682_friends_reach_controls_live(p_platform) THEN
    RAISE EXCEPTION 'friends_reach_controls_not_live' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.brand_circle_preferences AS p (
    user_id, extended_brand_reach_enabled, extended_brand_reach_decided_at
  ) VALUES (v_user, p_enabled, now())
  ON CONFLICT (user_id) DO UPDATE
    SET extended_brand_reach_enabled = EXCLUDED.extended_brand_reach_enabled,
        extended_brand_reach_decided_at = EXCLUDED.extended_brand_reach_decided_at;
  RETURN public.issue_3682_explorer_friends_reach_v1(p_platform);
END;
$fn$;

-- ── Leave / rejoin one brand's circle ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3682_set_brand_circle_exit_v1(
  p_brand_id uuid, p_stopped boolean, p_unfollow boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_user uuid := auth.uid(); v_now timestamptz := now();
BEGIN
  IF v_user IS NULL OR p_brand_id IS NULL OR p_stopped IS NULL THEN
    RAISE EXCEPTION 'friends_reach_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_stopped THEN
    IF COALESCE(p_unfollow, false) THEN
      DELETE FROM public.brand_follows WHERE user_id = v_user AND brand_id = p_brand_id;
    END IF;
    INSERT INTO public.brand_circle_exits AS x (brand_id, user_id, visibility_exited_at, delivery_exited_at)
    VALUES (p_brand_id, v_user, v_now, v_now)
    ON CONFLICT (brand_id, user_id) DO UPDATE
      SET visibility_exited_at = COALESCE(x.visibility_exited_at, EXCLUDED.visibility_exited_at),
          delivery_exited_at = COALESCE(x.delivery_exited_at, EXCLUDED.delivery_exited_at);
  ELSE
    DELETE FROM public.brand_circle_exits WHERE brand_id = p_brand_id AND user_id = v_user;
  END IF;
  RETURN jsonb_build_object(
    'brandId', p_brand_id,
    'stopped', p_stopped,
    'following', EXISTS (SELECT 1 FROM public.brand_follows bf
                          WHERE bf.user_id = v_user AND bf.brand_id = p_brand_id)
  );
END;
$fn$;

-- ── Follow vs exit ──────────────────────────────────────────────────────────
-- An explicit follow (brand page, follow-by-email) means "reach me again":
-- it clears the exit. An automatic follow never re-adds a guest who left.
CREATE OR REPLACE FUNCTION public.issue_3682_brand_follow_exit_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brand_circle_exits x
                  WHERE x.brand_id = NEW.brand_id AND x.user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.source IN ('purchase', 'rsvp', 'booking') THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.brand_circle_exits WHERE brand_id = NEW.brand_id AND user_id = NEW.user_id;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS issue_3682_brand_follow_exit_guard ON public.brand_follows;
CREATE TRIGGER issue_3682_brand_follow_exit_guard
BEFORE INSERT ON public.brand_follows
FOR EACH ROW EXECUTE FUNCTION public.issue_3682_brand_follow_exit_guard();

REVOKE ALL ON FUNCTION public.issue_3682_friends_reach_controls_live(text),
  public.issue_3682_explorer_friends_reach_v1(text),
  public.issue_3682_set_friends_reach_v1(text, boolean),
  public.issue_3682_set_brand_circle_exit_v1(uuid, boolean, boolean),
  public.issue_3682_brand_follow_exit_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3682_explorer_friends_reach_v1(text),
  public.issue_3682_set_friends_reach_v1(text, boolean),
  public.issue_3682_set_brand_circle_exit_v1(uuid, boolean, boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3682_friends_reach_controls_live(text) TO service_role;

-- ── Admin brand usage: one campaign group = one blast; invites count ────────
CREATE OR REPLACE FUNCTION public.admin_messaging_limits_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
  v_week_start timestamptz := timezone('utc', now()) - interval '7 days';
  v_defaults jsonb;
  v_brands jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT jsonb_build_object(
    'email_monthly', d.email_monthly,
    'sms_monthly', d.sms_monthly,
    'push_monthly', d.push_monthly,
    'week_warning_at', d.week_warning_at,
    'source', d.source,
    'set_at', l.set_at,
    'set_by_name', public.issue_4130_actor_name(l.set_by)
  )
  INTO v_defaults
  FROM public.brand_messaging_effective_limits(NULL) d
  LEFT JOIN public.brand_messaging_limits l ON l.brand_id IS NULL;

  WITH usage AS (
    SELECT e.brand_id,
      COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'email' AND e.confirmed_at >= v_month_start), 0)::integer AS email_used,
      COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'sms' AND e.confirmed_at >= v_month_start), 0)::integer AS sms_used,
      COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'push' AND e.confirmed_at >= v_month_start), 0)::integer AS push_used,
      -- #3682 — one campaign sent by push, email and SMS is ONE blast.
      COUNT(DISTINCT COALESCE(c.campaign_group_id, c.id)) FILTER (WHERE e.confirmed_at >= v_week_start)::integer AS blasts_this_week,
      SUM(e.estimated_cost_minor) FILTER (WHERE c.channel = 'sms' AND e.confirmed_at >= v_month_start) AS sms_cost_minor,
      COUNT(DISTINCT e.currency) FILTER (WHERE c.channel = 'sms' AND e.confirmed_at >= v_month_start AND e.estimated_cost_minor IS NOT NULL) AS sms_cost_currencies,
      MIN(e.currency) FILTER (WHERE c.channel = 'sms' AND e.confirmed_at >= v_month_start AND e.estimated_cost_minor IS NOT NULL) AS sms_cost_currency
    FROM public.marketing_book_send_executions e
    JOIN public.marketing_campaigns c ON c.id = e.campaign_id
    WHERE e.confirmed_at >= LEAST(v_month_start, v_week_start)
    GROUP BY e.brand_id
  ), listed AS (
    SELECT b.id, b.name, b.slug
    FROM public.brands b
    WHERE b.deleted_at IS NULL
       OR EXISTS (SELECT 1 FROM public.brand_messaging_limits l WHERE l.brand_id = b.id)
  ), rows AS (
    SELECT
      b.id AS brand_id,
      b.name AS brand_name,
      b.slug,
      COALESCE(u.email_used, 0) + private.issue_3682_account_invite_email_used(b.id) AS email_used,
      COALESCE(u.sms_used, 0) + public.issue_4111_subscribe_sms_used(b.id) AS sms_used,
      COALESCE(u.push_used, 0) AS push_used,
      COALESCE(u.blasts_this_week, 0) AS blasts_this_week,
      CASE WHEN u.sms_cost_currencies = 1 THEN u.sms_cost_minor END AS sms_cost_minor,
      CASE WHEN u.sms_cost_currencies = 1 THEN u.sms_cost_currency END AS sms_cost_currency,
      eff.email_monthly, eff.sms_monthly, eff.push_monthly, eff.week_warning_at,
      eff.source,
      o.email_monthly AS o_email, o.sms_monthly AS o_sms, o.push_monthly AS o_push,
      o.week_warning_at AS o_week, o.ends_at AS o_ends_at, o.reason AS o_reason,
      o.set_at AS o_set_at, o.set_by AS o_set_by, o.id AS o_id
    FROM listed b
    LEFT JOIN usage u ON u.brand_id = b.id
    LEFT JOIN public.brand_messaging_limits o ON o.brand_id = b.id
    CROSS JOIN LATERAL public.brand_messaging_effective_limits(b.id) eff
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'brand_id', r.brand_id,
      'brand_name', r.brand_name,
      'slug', r.slug,
      'email_used', r.email_used,
      'sms_used', r.sms_used,
      'push_used', r.push_used,
      'blasts_this_week', r.blasts_this_week,
      'sms_cost_minor', r.sms_cost_minor,
      'sms_cost_currency', r.sms_cost_currency,
      'email_monthly', r.email_monthly,
      'sms_monthly', r.sms_monthly,
      'push_monthly', r.push_monthly,
      'week_warning_at', r.week_warning_at,
      'source', r.source,
      'override', CASE WHEN r.o_id IS NULL THEN NULL ELSE jsonb_build_object(
        'email_monthly', r.o_email,
        'sms_monthly', r.o_sms,
        'push_monthly', r.o_push,
        'week_warning_at', r.o_week,
        'ends_at', r.o_ends_at,
        'reason', r.o_reason,
        'set_at', r.o_set_at,
        'set_by_name', public.issue_4130_actor_name(r.o_set_by),
        'active', (r.o_ends_at IS NULL OR r.o_ends_at > now())
      ) END
    ) ORDER BY (r.o_id IS NOT NULL) DESC, (r.email_used + r.sms_used + r.push_used) DESC, lower(r.brand_name)), '[]'::jsonb)
  INTO v_brands
  FROM rows r;

  RETURN jsonb_build_object(
    'month_start', v_month_start,
    'defaults', v_defaults,
    'brands', v_brands
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_messaging_limits_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_messaging_limits_overview() TO authenticated, service_role;

COMMIT;
