-- #4130 Wave 2b — Pricing and limits (messaging limits) and Subscriptions.
--
-- 1. brand_messaging_limits: one defaults row (brand_id IS NULL) plus at most
--    one override row per brand. Read only through SECURITY DEFINER functions.
-- 2. biz_brand_blast_usage_v1 / biz_assert_brand_blast_allowance_v1 keep their
--    signatures, the brand×channel advisory lock, the error code and the
--    #4111 subscribe-text SMS usage; the caps now come from
--    brand_messaging_effective_limits (active override, else the defaults row,
--    else the original literals 1,000 email / 100 SMS / push unlimited / warn
--    after 3 blasts a week).
-- 3. Admin RPCs (is_admin_user(), audited writes): read usage and limits,
--    change the defaults, raise or clear one brand's limits.
-- 4. Subscriptions: real tier without Global Plus, a paged/sorted list, the
--    overview counts and the overrides expiring soon (the browser cannot read
--    admin_subscription_overrides; RLS hides it, so these are RPCs). Staff and
--    test accounts are hidden from the list unless asked for.
-- 5. admin_set_global_plus(on, reason): the only switch for Global Plus;
--    reason required, audited, errors when nothing changed.
-- 6. No API role can TRUNCATE app_config (statement guard + revoked grant).
--
-- Invariant (declared in the pg17 test): I-4130-MESSAGING-LIMITS-ONE-SOURCE | issue #4130 | Monthly email/SMS/push caps for a brand come only from brand_messaging_effective_limits: an active override, else the defaults row, else 1000/100/unlimited.
-- Invariant (declared in the pg17 test): I-4130-MESSAGING-LIMITS-ADMIN-ONLY | issue #4130 | brand_messaging_limits is never readable or writable by anon or authenticated directly; admin RPCs check is_admin_user() and write admin_audit_log.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Table
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_messaging_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  email_monthly integer NOT NULL CHECK (email_monthly BETWEEN 0 AND 10000000),
  sms_monthly integer NOT NULL CHECK (sms_monthly BETWEEN 0 AND 10000000),
  push_monthly integer CHECK (push_monthly IS NULL OR push_monthly BETWEEN 0 AND 10000000),
  week_warning_at integer NOT NULL DEFAULT 3 CHECK (week_warning_at BETWEEN 1 AND 1000),
  ends_at timestamptz,
  reason text,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_messaging_limits_defaults_never_end
    CHECK (brand_id IS NOT NULL OR ends_at IS NULL)
);

COMMENT ON TABLE public.brand_messaging_limits IS
  '#4130: monthly messaging caps. brand_id NULL = the defaults row for every brand; a brand row overrides it until ends_at (NULL = no end). push_monthly NULL = unlimited.';

CREATE UNIQUE INDEX IF NOT EXISTS brand_messaging_limits_one_per_brand
  ON public.brand_messaging_limits (brand_id) WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brand_messaging_limits_one_defaults_row
  ON public.brand_messaging_limits ((true)) WHERE brand_id IS NULL;

ALTER TABLE public.brand_messaging_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_messaging_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_messaging_limits TO service_role;

INSERT INTO public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, push_monthly, week_warning_at, reason)
SELECT NULL, 1000, 100, NULL, 3, 'Original limits from #3682'
WHERE NOT EXISTS (SELECT 1 FROM public.brand_messaging_limits WHERE brand_id IS NULL);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. The one reader of a brand's effective limits.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_messaging_effective_limits(p_brand_id uuid)
RETURNS TABLE (
  email_monthly integer,
  sms_monthly integer,
  push_monthly integer,
  week_warning_at integer,
  source text,
  ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT x.email_monthly, x.sms_monthly, x.push_monthly, x.week_warning_at, x.source, x.ends_at
  FROM (
    SELECT 1 AS pri, l.email_monthly, l.sms_monthly, l.push_monthly, l.week_warning_at,
           'override'::text AS source, l.ends_at
    FROM public.brand_messaging_limits l
    WHERE p_brand_id IS NOT NULL
      AND l.brand_id = p_brand_id
      AND (l.ends_at IS NULL OR l.ends_at > now())
    UNION ALL
    SELECT 2, l.email_monthly, l.sms_monthly, l.push_monthly, l.week_warning_at,
           'default'::text, NULL::timestamptz
    FROM public.brand_messaging_limits l
    WHERE l.brand_id IS NULL
    UNION ALL
    SELECT 3, 1000, 100, NULL::integer, 3, 'built_in'::text, NULL::timestamptz
  ) x
  ORDER BY x.pri
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.brand_messaging_effective_limits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_messaging_effective_limits(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The two cap functions, same signatures (20270809003682, then
--    20271222004111 which added subscribe texts to SMS usage).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_brand_blast_usage_v1(
  p_actor_id uuid,
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_limits record;
  v_sms_used integer := 0;
  v_email_used integer := 0;
  v_push_used integer := 0;
  v_blasts_week integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
  v_week_start timestamptz := timezone('utc', now()) - interval '7 days';
BEGIN
  IF p_actor_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_limits FROM public.brand_messaging_effective_limits(p_brand_id);

  SELECT
    COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'sms'), 0)::integer,
    COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'email'), 0)::integer,
    COALESCE(SUM(e.reachable_count) FILTER (WHERE c.channel = 'push'), 0)::integer
  INTO v_sms_used, v_email_used, v_push_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND e.confirmed_at >= v_month_start;
  v_sms_used := v_sms_used + public.issue_4111_subscribe_sms_used(p_brand_id);

  SELECT COUNT(*)::integer
  INTO v_blasts_week
  FROM public.marketing_book_send_executions e
  WHERE e.brand_id = p_brand_id
    AND e.confirmed_at >= v_week_start;

  RETURN jsonb_build_object(
    'smsCap', v_limits.sms_monthly,
    'smsUsed', v_sms_used,
    'smsRemaining', GREATEST(v_limits.sms_monthly - v_sms_used, 0),
    'emailCap', v_limits.email_monthly,
    'emailUsed', v_email_used,
    'emailRemaining', GREATEST(v_limits.email_monthly - v_email_used, 0),
    'pushCap', v_limits.push_monthly,
    'pushUsed', v_push_used,
    'pushRemaining', CASE WHEN v_limits.push_monthly IS NULL THEN NULL
                          ELSE GREATEST(v_limits.push_monthly - v_push_used, 0) END,
    'limitSource', v_limits.source,
    'blastsThisWeek', v_blasts_week,
    'weekWarningAt', v_limits.week_warning_at
  );
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_brand_blast_usage_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_brand_blast_usage_v1(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_assert_brand_blast_allowance_v1(
  p_brand_id uuid,
  p_channel text,
  p_additional_reachable integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_limits record;
  v_cap integer;
  v_used integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
BEGIN
  IF COALESCE(p_additional_reachable, 0) <= 0 THEN
    RETURN;
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('sms', 'email', 'push') THEN
    RETURN;
  END IF;

  SELECT * INTO v_limits FROM public.brand_messaging_effective_limits(p_brand_id);
  v_cap := CASE p_channel
    WHEN 'sms' THEN v_limits.sms_monthly
    WHEN 'email' THEN v_limits.email_monthly
    ELSE v_limits.push_monthly
  END;
  -- NULL = no limit for this channel (push, unless an admin sets one).
  IF v_cap IS NULL THEN
    RETURN;
  END IF;

  -- Serialize brand×channel confirm races so two campaigns cannot both pass
  -- the pre-insert read and exceed the monthly aggregate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('blast_cap:' || p_brand_id::text || ':' || p_channel, 3682)
  );

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = p_channel
    AND e.confirmed_at >= v_month_start;
  IF p_channel = 'sms' THEN
    v_used := v_used + public.issue_4111_subscribe_sms_used(p_brand_id);
  END IF;

  IF v_used + p_additional_reachable > v_cap THEN
    RAISE EXCEPTION 'book_blast_monthly_cap_exceeded' USING ERRCODE = 'P0001';
  END IF;
END;
$f$;

REVOKE ALL ON FUNCTION public.biz_assert_brand_blast_allowance_v1(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_assert_brand_blast_allowance_v1(uuid, text, integer)
  TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Admin: read limits and this month's usage for every brand.
-- ───────────────────────────────────────────────────────────────────────────
-- A readable name for whoever set a limit: profile name, else sign-in email.
CREATE OR REPLACE FUNCTION public.issue_4130_actor_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN p_user_id IS NULL THEN NULL ELSE COALESCE(
    (SELECT NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
       FROM public.profiles p WHERE p.id = p_user_id),
    (SELECT u.email::text FROM auth.users u WHERE u.id = p_user_id),
    'an admin'
  ) END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4130_actor_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4130_actor_name(uuid) TO service_role;

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
      COUNT(*) FILTER (WHERE e.confirmed_at >= v_week_start)::integer AS blasts_this_week,
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
      COALESCE(u.email_used, 0) AS email_used,
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

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Admin writes (audited).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4130_check_limit_values(
  p_email integer, p_sms integer, p_push integer, p_week_warning_at integer
) RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_email IS NULL OR p_sms IS NULL OR p_week_warning_at IS NULL
     OR p_email < 0 OR p_email > 10000000
     OR p_sms < 0 OR p_sms > 10000000
     OR (p_push IS NOT NULL AND (p_push < 0 OR p_push > 10000000))
     OR p_week_warning_at < 1 OR p_week_warning_at > 1000 THEN
    RAISE EXCEPTION 'messaging_limit_out_of_bounds';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4130_check_limit_values(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_messaging_limit_defaults(
  p_email_monthly integer,
  p_sms_monthly integer,
  p_push_monthly integer,
  p_week_warning_at integer,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  PERFORM public.issue_4130_check_limit_values(p_email_monthly, p_sms_monthly, p_push_monthly, p_week_warning_at);

  SELECT to_jsonb(d) INTO v_before FROM public.brand_messaging_effective_limits(NULL) d;

  UPDATE public.brand_messaging_limits
     SET email_monthly = p_email_monthly,
         sms_monthly = p_sms_monthly,
         push_monthly = p_push_monthly,
         week_warning_at = p_week_warning_at,
         reason = btrim(p_reason),
         set_by = auth.uid(),
         set_at = now()
   WHERE brand_id IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, push_monthly, week_warning_at, reason, set_by)
    VALUES (NULL, p_email_monthly, p_sms_monthly, p_push_monthly, p_week_warning_at, btrim(p_reason), auth.uid());
  END IF;

  PERFORM public.admin_write_audit('messaging_limits.defaults_set', 'brand_messaging_limits', 'defaults', p_reason,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object(
      'email_monthly', p_email_monthly, 'sms_monthly', p_sms_monthly,
      'push_monthly', p_push_monthly, 'week_warning_at', p_week_warning_at)));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_messaging_limit_defaults(integer, integer, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_messaging_limit_defaults(integer, integer, integer, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_brand_messaging_limits(
  p_brand_id uuid,
  p_email_monthly integer,
  p_sms_monthly integer,
  p_push_monthly integer,
  p_week_warning_at integer,
  p_ends_at timestamptz,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_brand_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.brands WHERE id = p_brand_id) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at <= now() THEN
    RAISE EXCEPTION 'messaging_limit_end_in_past';
  END IF;
  PERFORM public.issue_4130_check_limit_values(p_email_monthly, p_sms_monthly, p_push_monthly, p_week_warning_at);

  SELECT to_jsonb(l) - 'id' INTO v_before FROM public.brand_messaging_limits l WHERE l.brand_id = p_brand_id;

  INSERT INTO public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, push_monthly, week_warning_at, ends_at, reason, set_by, set_at)
  VALUES (p_brand_id, p_email_monthly, p_sms_monthly, p_push_monthly, p_week_warning_at, p_ends_at, btrim(p_reason), auth.uid(), now())
  ON CONFLICT (brand_id) WHERE brand_id IS NOT NULL DO UPDATE
    SET email_monthly = EXCLUDED.email_monthly,
        sms_monthly = EXCLUDED.sms_monthly,
        push_monthly = EXCLUDED.push_monthly,
        week_warning_at = EXCLUDED.week_warning_at,
        ends_at = EXCLUDED.ends_at,
        reason = EXCLUDED.reason,
        set_by = EXCLUDED.set_by,
        set_at = EXCLUDED.set_at;

  PERFORM public.admin_write_audit('messaging_limits.brand_set', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object(
      'email_monthly', p_email_monthly, 'sms_monthly', p_sms_monthly,
      'push_monthly', p_push_monthly, 'week_warning_at', p_week_warning_at,
      'ends_at', p_ends_at)));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_brand_messaging_limits(uuid, integer, integer, integer, integer, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_brand_messaging_limits(uuid, integer, integer, integer, integer, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_brand_messaging_limits(
  p_brand_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  DELETE FROM public.brand_messaging_limits
   WHERE brand_id = p_brand_id
   RETURNING to_jsonb(brand_messaging_limits) - 'id' INTO v_before;

  IF v_before IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'cleared', false);
  END IF;

  PERFORM public.admin_write_audit('messaging_limits.brand_cleared', 'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before));

  RETURN jsonb_build_object('ok', true, 'cleared', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_clear_brand_messaging_limits(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_brand_messaging_limits(uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Subscriptions.
-- ───────────────────────────────────────────────────────────────────────────
-- The tier a person would have with Global Plus off: get_effective_tier's
-- priorities after the global switch (admin override, paid, trial, referral).
-- Keep in step with get_effective_tier.
CREATE OR REPLACE FUNCTION public.subscription_tier_without_global(p_user_id uuid)
RETURNS TABLE (tier text, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_override_tier text;
BEGIN
  SELECT o.tier INTO v_override_tier
  FROM public.admin_subscription_overrides o
  WHERE o.user_id = p_user_id
    AND o.revoked_at IS NULL
    AND o.starts_at <= now()
    AND o.expires_at > now()
  ORDER BY CASE o.tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
  LIMIT 1;
  IF v_override_tier IS NOT NULL THEN
    tier := v_override_tier; source := 'admin'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions s WHERE s.user_id = p_user_id;
  IF NOT FOUND THEN
    tier := 'free'; source := 'none'; RETURN NEXT; RETURN;
  END IF;
  IF v_sub.tier = 'mingla_plus' AND v_sub.is_active = true AND v_sub.current_period_end > now() THEN
    tier := 'mingla_plus'; source := 'paid'; RETURN NEXT; RETURN;
  END IF;
  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at > now() THEN
    tier := 'mingla_plus'; source := 'trial'; RETURN NEXT; RETURN;
  END IF;
  IF v_sub.referral_bonus_months > 0
     AND v_sub.referral_bonus_started_at IS NOT NULL
     AND v_sub.referral_bonus_started_at + (v_sub.referral_bonus_months * INTERVAL '30 days') > now() THEN
    tier := 'mingla_plus'; source := 'referral'; RETURN NEXT; RETURN;
  END IF;
  tier := 'free'; source := 'none'; RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.subscription_tier_without_global(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_tier_without_global(uuid) TO service_role;

-- p_show_internal: the tiles leave out staff and test accounts exactly when
-- the list does (public.admin_account_is_internal, the one rule);
-- `internal_hidden` says how many were left out.
DROP FUNCTION IF EXISTS public.admin_subscription_overview();
CREATE OR REPLACE FUNCTION public.admin_subscription_overview(p_show_internal boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH everyone AS (
    SELECT p.id, public.admin_account_is_internal(p.id) AS internal
    FROM public.profiles p
  ), people AS (
    SELECT e.id, r.tier, r.source
    FROM everyone e
    CROSS JOIN LATERAL public.subscription_tier_without_global(e.id) r
    WHERE COALESCE(p_show_internal, false) OR NOT e.internal
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM people),
    'global_plus', COALESCE((SELECT config_value = 'true' FROM public.app_config WHERE config_key = 'global_plus_access'), false),
    'real_plus', (SELECT count(*) FROM people WHERE tier = 'mingla_plus'),
    'real_free', (SELECT count(*) FROM people WHERE tier = 'free'),
    'paid', (SELECT count(*) FROM people WHERE source = 'paid'),
    'admin_given', (SELECT count(*) FROM people WHERE source = 'admin'),
    'expiring_3d', (
      SELECT count(*) FROM public.admin_subscription_overrides o
      JOIN people pe ON pe.id = o.user_id
      WHERE o.revoked_at IS NULL AND o.starts_at <= now()
        AND o.expires_at > now() AND o.expires_at <= now() + interval '3 days'),
    'internal_hidden', CASE WHEN COALESCE(p_show_internal, false) THEN 0
                            ELSE (SELECT count(*) FROM everyone WHERE internal) END,
    'show_internal', COALESCE(p_show_internal, false)
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_subscription_overview(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_subscription_overview(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_subscription_overrides_expiring(p_within_days integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_within_days, 3), 1), 90);
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'override_id', o.id,
      'user_id', o.user_id,
      'display_name', NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
      'tier', o.tier,
      'expires_at', o.expires_at
    ) ORDER BY o.expires_at), '[]'::jsonb)
  INTO v_rows
  FROM public.admin_subscription_overrides o
  LEFT JOIN public.profiles p ON p.id = o.user_id
  WHERE o.revoked_at IS NULL
    AND o.starts_at <= now()
    AND o.expires_at > now()
    AND o.expires_at <= now() + make_interval(days => v_days);

  RETURN jsonb_build_object('within_days', v_days, 'count', jsonb_array_length(v_rows), 'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_subscription_overrides_expiring(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_subscription_overrides_expiring(integer) TO authenticated, service_role;

-- Paged, sorted and filtered over everyone (sort and export cover the whole
-- filtered list). p_filter: NULL | 'plus' | 'free' | 'admin' (real tier).
-- p_sort: 'joined' | 'name' | 'real_tier' | 'override_expires_at'.
-- p_show_internal: staff and test accounts are left out unless asked for
-- (the one rule, public.admin_account_is_internal, from the Wave 3 migration
-- 20280113004130; PL/pgSQL resolves it when the function runs, and every
-- migration here is applied together). `internal_hidden` says how many.
DROP FUNCTION IF EXISTS public.admin_list_subscriptions_v2(text, text, text, boolean, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions_v2(
  p_search text DEFAULT NULL,
  p_filter text DEFAULT NULL,
  p_sort text DEFAULT 'joined',
  p_desc boolean DEFAULT true,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_show_internal boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 5000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_pattern text;
  v_global boolean;
  v_total integer;
  v_rows jsonb;
  v_internal_hidden integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_filter IS NOT NULL AND p_filter NOT IN ('plus', 'free', 'admin') THEN
    RAISE EXCEPTION 'invalid_filter';
  END IF;
  IF COALESCE(p_sort, 'joined') NOT IN ('joined', 'name', 'real_tier', 'override_expires_at') THEN
    RAISE EXCEPTION 'invalid_sort';
  END IF;

  v_global := COALESCE((SELECT config_value = 'true' FROM public.app_config WHERE config_key = 'global_plus_access'), false);
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH base AS (
    SELECT
      p.id AS user_id,
      NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '') AS display_name,
      NULLIF(btrim(COALESCE(p.first_name, '')), '') AS first_name,
      p.phone,
      p.created_at,
      r.tier AS real_tier,
      r.source AS real_source,
      ao.id AS override_id,
      ao.tier AS override_tier,
      ao.expires_at AS override_expires_at,
      s.trial_ends_at,
      s.current_period_end,
      public.admin_account_is_internal(p.id) AS internal
    FROM public.profiles p
    CROSS JOIN LATERAL public.subscription_tier_without_global(p.id) r
    LEFT JOIN public.subscriptions s ON s.user_id = p.id
    LEFT JOIN LATERAL (
      SELECT o.id, o.tier, o.expires_at FROM public.admin_subscription_overrides o
      WHERE o.user_id = p.id AND o.revoked_at IS NULL AND o.starts_at <= now() AND o.expires_at > now()
      ORDER BY CASE o.tier WHEN 'mingla_plus' THEN 2 ELSE 1 END DESC
      LIMIT 1
    ) ao ON true
    WHERE (v_pattern IS NULL
           OR p.first_name ILIKE v_pattern
           OR p.last_name ILIKE v_pattern
           OR p.phone ILIKE v_pattern)
  ), shown AS (
    SELECT * FROM base WHERE COALESCE(p_show_internal, false) OR NOT base.internal
  ), filtered AS (
    SELECT * FROM shown
    WHERE p_filter IS NULL
       OR (p_filter = 'plus' AND real_tier = 'mingla_plus')
       OR (p_filter = 'free' AND real_tier = 'free')
       OR (p_filter = 'admin' AND override_id IS NOT NULL)
  ), counted AS (
    SELECT f.*, count(*) OVER () AS total_count FROM filtered f
  ), ordered AS (
    SELECT c.*,
      row_number() OVER (ORDER BY
        CASE WHEN COALESCE(p_sort, 'joined') = 'joined' AND NOT COALESCE(p_desc, true) THEN c.created_at END ASC NULLS LAST,
        CASE WHEN COALESCE(p_sort, 'joined') = 'joined' AND COALESCE(p_desc, true) THEN c.created_at END DESC NULLS LAST,
        CASE WHEN p_sort = 'name' AND NOT COALESCE(p_desc, true) THEN lower(c.display_name) END ASC NULLS LAST,
        CASE WHEN p_sort = 'name' AND COALESCE(p_desc, true) THEN lower(c.display_name) END DESC NULLS LAST,
        CASE WHEN p_sort = 'real_tier' AND NOT COALESCE(p_desc, true) THEN c.real_tier END ASC NULLS LAST,
        CASE WHEN p_sort = 'real_tier' AND COALESCE(p_desc, true) THEN c.real_tier END DESC NULLS LAST,
        CASE WHEN p_sort = 'override_expires_at' AND NOT COALESCE(p_desc, true) THEN c.override_expires_at END ASC NULLS LAST,
        CASE WHEN p_sort = 'override_expires_at' AND COALESCE(p_desc, true) THEN c.override_expires_at END DESC NULLS LAST,
        c.created_at DESC, c.user_id
      ) AS rn
    FROM counted c
  )
  SELECT
    COALESCE(MAX(o.total_count), 0)::integer,
    COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', o.user_id,
      'display_name', o.display_name,
      'has_first_name', o.first_name IS NOT NULL,
      'phone', o.phone,
      'real_tier', o.real_tier,
      'real_source', o.real_source,
      'gets_now', CASE WHEN v_global THEN 'mingla_plus' ELSE o.real_tier END,
      'gets_now_reason', CASE WHEN v_global AND o.real_tier = 'free' THEN 'global' ELSE o.real_source END,
      'override_id', o.override_id,
      'override_tier', o.override_tier,
      'override_expires_at', o.override_expires_at,
      'trial_ends_at', o.trial_ends_at,
      'current_period_end', o.current_period_end,
      'created_at', o.created_at,
      'internal', o.internal
    ) ORDER BY o.rn) FILTER (WHERE o.rn > v_offset AND o.rn <= v_offset + v_limit), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ordered o;

  -- Staff and test accounts the list left out for this search and filter.
  SELECT count(*)::integer INTO v_internal_hidden
    FROM public.profiles p
   WHERE NOT COALESCE(p_show_internal, false)
     AND (v_pattern IS NULL OR p.first_name ILIKE v_pattern OR p.last_name ILIKE v_pattern OR p.phone ILIKE v_pattern)
     AND public.admin_account_is_internal(p.id);

  RETURN jsonb_build_object('total', v_total, 'global_plus', v_global, 'rows', v_rows,
    'internal_hidden', COALESCE(v_internal_hidden, 0), 'show_internal', COALESCE(p_show_internal, false));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_subscriptions_v2(text, text, text, boolean, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_subscriptions_v2(text, text, text, boolean, integer, integer, boolean) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Global Plus: switched only through this audited admin RPC.
-- ───────────────────────────────────────────────────────────────────────────
-- Needs a reason, writes admin_audit_log with before and after, and refuses
-- when nothing changed (already in that state, or the setting row is missing),
-- so the page can never report a switch that did not happen.
CREATE OR REPLACE FUNCTION public.admin_set_global_plus(p_on boolean, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_before text;
  v_after text := CASE WHEN p_on THEN 'true' ELSE 'false' END;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'state_required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT config_value INTO v_before FROM public.app_config WHERE config_key = 'global_plus_access' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'global_plus_setting_missing';
  END IF;

  UPDATE public.app_config
     SET config_value = v_after, updated_at = now()
   WHERE config_key = 'global_plus_access'
     AND config_value IS DISTINCT FROM v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_change';
  END IF;

  PERFORM public.admin_write_audit('subscriptions.global_plus_set', 'app_config', 'global_plus_access', p_reason,
    jsonb_build_object('before', v_before, 'after', v_after));

  RETURN jsonb_build_object('ok', true, 'global_plus', p_on);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_global_plus(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_global_plus(boolean, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Global Plus has one write path.
-- ───────────────────────────────────────────────────────────────────────────
-- The app_config RLS policies let any admin insert, update or delete a row
-- straight from the browser, with no reason and no audit. For the
-- global_plus_access row that is refused for every API role (anon,
-- authenticated, service_role): the only way to change it is
-- admin_set_global_plus above, which runs as the function owner. Every other
-- app_config key is untouched. Not SECURITY DEFINER on purpose: current_user
-- must be the caller's role.
CREATE OR REPLACE FUNCTION public.issue_4130_guard_global_plus_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated', 'service_role')
     AND ((TG_OP IN ('UPDATE', 'DELETE') AND OLD.config_key = 'global_plus_access')
       OR (TG_OP IN ('INSERT', 'UPDATE') AND NEW.config_key = 'global_plus_access')) THEN
    RAISE EXCEPTION 'global_plus_use_admin_set_global_plus'
      USING ERRCODE = '42501',
            HINT = 'Change Global Plus on the Subscriptions page (admin_set_global_plus), with a reason.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4130_guard_global_plus_config() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4130_guard_global_plus_config ON public.app_config;
CREATE TRIGGER issue_4130_guard_global_plus_config
  BEFORE INSERT OR UPDATE OR DELETE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.issue_4130_guard_global_plus_config();

-- ───────────────────────────────────────────────────────────────────────────
-- 7. No API role can empty app_config.
-- ───────────────────────────────────────────────────────────────────────────
-- Row triggers do not fire on TRUNCATE, and the default grants give the API
-- roles TRUNCATE on public tables, so one TRUNCATE would wipe every setting,
-- Global Plus included, with no reason and no audit. A statement-level guard
-- refuses it for anon, authenticated and service_role (it holds even if a
-- grant is added back later), and the TRUNCATE grant is revoked as well.
-- Not SECURITY DEFINER on purpose: current_user must be the caller's role.
CREATE OR REPLACE FUNCTION public.issue_4130_guard_app_config_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'app_config_truncate_refused'
      USING ERRCODE = '42501',
            HINT = 'Settings are changed one at a time, never emptied.';
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4130_guard_app_config_truncate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4130_guard_app_config_truncate ON public.app_config;
CREATE TRIGGER issue_4130_guard_app_config_truncate
  BEFORE TRUNCATE ON public.app_config
  FOR EACH STATEMENT EXECUTE FUNCTION public.issue_4130_guard_app_config_truncate();

REVOKE TRUNCATE ON public.app_config FROM anon, authenticated, service_role;

COMMIT;
